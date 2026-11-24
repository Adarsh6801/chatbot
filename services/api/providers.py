"""Optional provider adapters. The local path requires no external services."""
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
import httpx
from sqlalchemy import text
from .rag import embed

log = logging.getLogger('agentforge')
DIMENSIONS = 256

def embedding_model():
    provider = os.getenv('EMBEDDING_PROVIDER', 'local')
    if provider == 'openai': return 'openai:' + os.getenv('EMBEDDING_MODEL', 'text-embedding-3-small')
    return 'local:feature-hash-256'

async def embeddings(texts, model=None):
    model = model or embedding_model()
    if model.startswith('local:'): return [embed(t, DIMENSIONS) for t in texts]
    key = os.getenv('OPENAI_API_KEY')
    if not key: raise ValueError('OpenAI embeddings require OPENAI_API_KEY.')
    result = []
    async with httpx.AsyncClient(timeout=60) as client:
        for start in range(0, len(texts), 64):
            response = await client.post('https://api.openai.com/v1/embeddings', headers={'Authorization': 'Bearer ' + key}, json={'model': model.split(':', 1)[1], 'input': texts[start:start+64], 'dimensions': DIMENSIONS})
            response.raise_for_status()
            batch = sorted(response.json()['data'], key=lambda row: row['index'])
            vectors = [row['embedding'] for row in batch]
            if any(len(v) != DIMENSIONS for v in vectors): raise ValueError('Embedding provider returned unexpected dimensions.')
            result.extend(vectors)
    return result

async def hybrid_search(db, bot_id, query):
    from .database import Chunk, engine
    from .rag import retrieve, rrf
    models = [row[0] for row in db.query(Chunk.embedding_model).filter_by(bot_id=bot_id).distinct().all()]
    hits = []
    for model in models:
        query_vector = (await embeddings([query], model))[0]
        if engine.dialect.name == 'postgresql':
            # Indexed candidate retrieval, always scoped by bot and embedding version.
            vector_ids = [r[0] for r in db.execute(text('SELECT id FROM chunks WHERE bot_id = :bot AND embedding_model = :model ORDER BY embedding <=> CAST(:vector AS vector) LIMIT 50'), {'bot':bot_id,'model':model,'vector':json.dumps(query_vector)})]
            keyword_ids = [r[0] for r in db.execute(text("SELECT id FROM chunks WHERE bot_id = :bot AND embedding_model = :model AND to_tsvector('english', content) @@ plainto_tsquery('english', :query) ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', :query)) DESC LIMIT 50"), {'bot':bot_id,'model':model,'query':query})]
            candidates = db.query(Chunk).filter(Chunk.bot_id == bot_id, Chunk.id.in_(set(vector_ids + keyword_ids))).all()
        else:
            candidates = db.query(Chunk).filter_by(bot_id=bot_id, embedding_model=model).all()
        hits += retrieve(query, candidates, limit=50, query_vector=query_vector)
    return sorted(hits, key=lambda h:h['confidence'], reverse=True)[:50]

async def export_trace(trace_id, bot_id, input_text, output_text, metadata):
    public, secret = os.getenv('LANGFUSE_PUBLIC_KEY'), os.getenv('LANGFUSE_SECRET_KEY')
    if not public or not secret: return
    timestamp = datetime.now(timezone.utc).isoformat()
    trace = {'id': trace_id, 'name':'agentforge.chat', 'timestamp':timestamp, 'input':input_text, 'output':output_text, 'metadata':metadata, 'tags':['agentforge',bot_id]}
    start = (datetime.now(timezone.utc)-timedelta(milliseconds=metadata.get('latency_ms',0))).isoformat()
    generation = {'id':str(uuid.uuid4()),'traceId':trace_id,'name':'answer','startTime':start,'endTime':timestamp,'model':metadata.get('model'),'input':input_text,'output':output_text,'metadata':metadata,'usageDetails':{'total':metadata.get('tokens',0)},'costDetails':{'total':metadata.get('cost_cents',0)/100}}
    batch = [{'id':str(uuid.uuid4()),'timestamp':timestamp,'type':'trace-create','body':trace},{'id':str(uuid.uuid4()),'timestamp':timestamp,'type':'generation-create','body':generation}]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(os.getenv('LANGFUSE_HOST','https://cloud.langfuse.com').rstrip('/')+'/api/public/ingestion', auth=(public,secret), json={'batch':batch})
            response.raise_for_status()
    except httpx.HTTPError:
        log.warning('Langfuse trace export failed; local trace remains available.')

def store_raw(document_id, name, raw):
    bucket = os.getenv('S3_BUCKET')
    if not bucket: return ''
    import boto3
    client = boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT_URL') or None)
    prefix = os.getenv('S3_KEY_PREFIX', 'documents').strip('/')
    key = '/'.join(part for part in (prefix, document_id, name) if part)
    extra = {} if os.getenv('S3_ENDPOINT_URL') else {'ServerSideEncryption':'AES256'}
    client.put_object(Bucket=bucket, Key=key, Body=raw, ContentType='application/octet-stream', **extra)
    return 's3://' + bucket + '/' + key

def store_widget_logo(bot_id, extension, raw, content_type):
    bucket = os.getenv('S3_BUCKET')
    if not bucket: raise RuntimeError('S3_BUCKET is not configured')
    import boto3, uuid
    client = boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT_URL') or None)
    key = f'agent-assets/{bot_id}/logos/{uuid.uuid4().hex}.{extension}'
    extra = {'ContentType': content_type, 'CacheControl': 'public, max-age=3600'}
    if not os.getenv('S3_ENDPOINT_URL'): extra['ServerSideEncryption'] = 'AES256'
    client.put_object(Bucket=bucket, Key=key, Body=raw, **extra)
    return f's3://{bucket}/{key}'

def read_widget_logo(uri):
    bucket = os.getenv('S3_BUCKET')
    if not bucket or not uri.startswith(f's3://{bucket}/agent-assets/'):
        raise FileNotFoundError('Logo object not found')
    import boto3
    _, _, object_path = uri.partition(f's3://{bucket}/')
    response = boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT_URL') or None).get_object(Bucket=bucket, Key=object_path)
    return response['Body'].read(), response.get('ContentType', 'application/octet-stream')

def store_site_logo(raw):
    bucket = os.getenv('S3_BUCKET')
    if not bucket: raise RuntimeError('S3_BUCKET is not configured')
    import boto3, uuid
    client = boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT_URL') or None)
    key = f'site-assets/branding/{uuid.uuid4().hex}.png'
    extra = {'ContentType':'image/png','CacheControl':'public, max-age=3600'}
    if not os.getenv('S3_ENDPOINT_URL'): extra['ServerSideEncryption'] = 'AES256'
    client.put_object(Bucket=bucket,Key=key,Body=raw,**extra)
    return f's3://{bucket}/{key}'

def read_site_logo(uri):
    bucket = os.getenv('S3_BUCKET')
    if not bucket or not uri.startswith(f's3://{bucket}/site-assets/branding/'):
        raise FileNotFoundError('Site logo not found')
    import boto3
    _, _, key = uri.partition(f's3://{bucket}/')
    response = boto3.client('s3',endpoint_url=os.getenv('S3_ENDPOINT_URL') or None).get_object(Bucket=bucket,Key=key)
    return response['Body'].read(),response.get('ContentType','application/octet-stream')

def delete_widget_logo(uri):
    bucket = os.getenv('S3_BUCKET')
    if not bucket or not uri.startswith(f's3://{bucket}/agent-assets/'):
        return
    import boto3
    _, _, object_path = uri.partition(f's3://{bucket}/')
    boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT_URL') or None).delete_object(Bucket=bucket, Key=object_path)
