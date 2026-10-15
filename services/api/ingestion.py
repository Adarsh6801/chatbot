import asyncio
import io
import ipaddress
import re
import socket
import zipfile
import time
from sqlalchemy import update, or_, and_
from html.parser import HTMLParser
from urllib.parse import urlparse
from xml.etree import ElementTree
import httpx
from .database import Session, Document, Chunk, EvalRun
from .rag import chunk_text, embed, evaluate

MAX_BYTES = 10 * 1024 * 1024

class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.hidden += 1
        if tag in ('p', 'br', 'div', 'h1', 'h2', 'li'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.hidden: self.hidden -= 1
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def parse_file(name, raw):
    extension = name.rsplit('.', 1)[-1].lower()
    if len(raw) > MAX_BYTES: raise ValueError('Files must be smaller than 10 MB.')
    if extension in ('txt', 'md'):
        if b'\x00' in raw: raise ValueError('The file is not a text document.')
        return raw.decode('utf-8-sig')
    if extension == 'pdf':
        if not raw.startswith(b'%PDF-'): raise ValueError('Invalid PDF file signature.')
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        if len(reader.pages) > 300: raise ValueError('PDFs are limited to 300 pages.')
        return '\n'.join(page.extract_text() or '' for page in reader.pages)
    if extension == 'docx':
        if not raw.startswith(b'PK'): raise ValueError('Invalid DOCX file signature.')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if sum(i.file_size for i in infos) > 40 * MAX_BYTES: raise ValueError('Expanded document is too large.')
            xml = archive.read('word/document.xml')
        tree = ElementTree.fromstring(xml)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        return '\n'.join(''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in tree.findall('.//w:p', ns))
    raise ValueError('Supported formats: PDF, DOCX, TXT, and Markdown.')

async def fetch_url(url):
    """Pin public DNS results to prevent redirects and DNS rebinding into private networks."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Enter a public HTTP or HTTPS URL.')
    if parsed.port not in (None, 80, 443): raise ValueError('Only standard HTTP and HTTPS ports are allowed.')
    host = parsed.hostname.encode('idna').decode()
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    addresses = await asyncio.to_thread(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    ips = [item[4][0] for item in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError('Private, loopback, and reserved network URLs are not allowed.')
    # Connect to the validated numeric address; TLS still uses the original server name.
    ip = ips[0]
    numeric_host = f'[{ip}]' if ':' in ip else ip
    path = parsed.path or '/'
    target = f'{parsed.scheme}://{numeric_host}{path}' + ('?' + parsed.query if parsed.query else '')
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
        async with client.stream('GET', target, headers={'Host': host, 'User-Agent': 'AgentForge/1.0'}, extensions={'sni_hostname': host}) as response:
            if response.is_redirect: raise ValueError('Use the final URL; redirects are not followed for security.')
            response.raise_for_status()
            if 'text/html' not in response.headers.get('content-type', '') and 'text/plain' not in response.headers.get('content-type', ''):
                raise ValueError('The URL must return HTML or plain text.')
            raw = bytearray()
            async for block in response.aiter_bytes():
                raw.extend(block)
                if len(raw) > MAX_BYTES: raise ValueError('Website content exceeds 10 MB.')
    parser = TextHTML()
    parser.feed(raw.decode('utf-8', errors='replace'))
    return re.sub(r'[ \t]+', ' ', ''.join(parser.parts)).strip()

def eval_bot(db, bot_id):
    chunks = db.query(Chunk).filter_by(bot_id=bot_id).all()
    grounded, relevance, details = evaluate(chunks)
    db.add(EvalRun(bot_id=bot_id, score_faithfulness=grounded, score_relevancy=relevance, sample_size=len(details), details=details))

async def ingest(document_id):
    for attempt in range(3):
        try:
            with Session() as db:
                doc = db.get(Document, document_id)
                if not doc: return
                if attempt == 0:
                    claim = db.execute(update(Document).where(Document.id == document_id, or_(Document.status.in_(['PENDING','FAILED']),and_(Document.status == 'PROCESSING',Document.processing_at < time.time()-600))).values(status='PROCESSING',processing_at=time.time()))
                    db.commit()
                    if claim.rowcount != 1: return
                    db.refresh(doc)
                doc.status = 'PROCESSING'
                doc.error = None
                db.commit()
                content = await fetch_url(doc.source_uri) if doc.source_type == 'url' else doc.content
                if not content.strip(): raise ValueError('No readable text found. Scanned PDFs need OCR before upload.')
                chunks = chunk_text(content)
                if len(chunks) > 1000: raise ValueError('Document exceeds 1000 chunks.')
                from .providers import embeddings, embedding_model
                model = embedding_model()
                vectors = await embeddings(chunks, model)
                # A source could be deleted while provider work was in flight.
                db.expire_all()
                doc = db.get(Document, document_id)
                if not doc: return
                db.query(Chunk).filter_by(document_id=doc.id).delete()
                db.add_all([Chunk(bot_id=doc.bot_id, document_id=doc.id, content=text, embedding=vector, embedding_model=model, ordinal=i) for i, (text, vector) in enumerate(zip(chunks, vectors))])
                doc.content, doc.chunk_count, doc.status = content, len(chunks), 'READY'
                db.flush()
                eval_bot(db, doc.bot_id)
                db.commit()
                import os, logging
                if os.getenv('EVAL_PROVIDER') == 'openai':
                    try:
                        from .evals import evaluate_live
                        all_chunks = db.query(Chunk).filter_by(bot_id=doc.bot_id).all()
                        grounding,relevance,details = await evaluate_live(db,doc.bot_id,all_chunks)
                        db.add(EvalRun(bot_id=doc.bot_id,score_faithfulness=grounding,score_relevancy=relevance,sample_size=len(details),details=details,method='LLM synthetic QA and judge'))
                        db.commit()
                    except Exception:
                        logging.getLogger('agentforge').warning('LLM evaluation failed; ingestion and local evaluation remain available.')
            return
        except Exception as error:
            if attempt == 2 or isinstance(error, ValueError):
                with Session() as db:
                    doc = db.get(Document, document_id)
                    if doc:
                        doc.status = 'FAILED'
                        doc.error = str(error)[:300] if isinstance(error, ValueError) else 'Ingestion failed. Check the URL or file and retry.'
                        db.commit()
                return
            await asyncio.sleep(2 ** attempt)
