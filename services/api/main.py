import asyncio
import json
import logging
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession
from .config import WEB_ORIGIN, PUBLIC_WEB_URL, PRODUCTION, PLANS
from .database import Base, engine, Session, get_db, User, LoginSession, Bot, Document, Chunk, Conversation, Message, Flag, EvalRun, ApiKey, Workflow, WorkflowApiLog, BotActivityLog, now
from .security import current_user, owned_bot, password_hash, verify_password, digest, rate_limit
from .ingestion import ingest, parse_file, eval_bot, MAX_BYTES
from .rag import retrieve, rerank, generate, generate_stream, INJECTION
from .providers import hybrid_search, export_trace, store_raw
from .workers import dispatch
from sqlalchemy import text, update

@asynccontextmanager
async def lifespan(app):
    from .migrations import migrate
    migrate()
    # Resume persisted ingestion jobs interrupted by an API restart.
    with Session() as db:
        if not os.getenv('REDIS_URL'):
            db.query(Document).filter_by(status='PROCESSING').update({'status':'PENDING'})
            db.commit()
        pending = [d.id for d in db.query(Document).filter(Document.status.in_(['PENDING', 'PROCESSING'])).all()]
    if os.getenv('REDIS_URL'):
        for id in pending: dispatch(None, id)
        tasks = []
    else: tasks = [asyncio.create_task(ingest(id)) for id in pending]
    yield
    for task in tasks: task.cancel()
    if tasks: await asyncio.gather(*tasks, return_exceptions=True)

app = FastAPI(title='AgentForge API', version='1.0.0', lifespan=lifespan)
from .oauth import router as oauth_router
app.include_router(oauth_router)
from .workflow import router as workflow_router, record_api_log, record_bot_log
app.include_router(workflow_router)
from .admin import router as admin_router
app.include_router(admin_router)
from .support import router as support_router
app.include_router(support_router)
from .billing import router as billing_router
app.include_router(billing_router)
from .payment_settings import get_payment_provider, payment_provider_status
ADMIN_WEB_ORIGIN = os.getenv('ADMIN_WEB_ORIGIN', 'http://localhost:3001')
TRUSTED_WEB_ORIGINS = [WEB_ORIGIN, ADMIN_WEB_ORIGIN]
app.add_middleware(CORSMiddleware, allow_origins=TRUSTED_WEB_ORIGINS, allow_credentials=True, allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allow_headers=['Content-Type', 'Authorization', 'X-AgentForge-Client'])

@app.middleware('http')
async def security_headers(request, call_next):
    if request.method == 'OPTIONS' and request.url.path.startswith('/api/v1/chat/'):
        headers = {'Access-Control-Allow-Origin': request.headers.get('origin') if request.headers.get('origin') == WEB_ORIGIN else '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}
        if request.headers.get('origin') == WEB_ORIGIN: headers['Access-Control-Allow-Credentials'] = 'true'
        return Response(headers=headers)
    # Cookie-authenticated mutations require the trusted origin; API keys use explicit credentials.
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and request.cookies.get('agentforge_session') and not request.url.path.startswith('/api/v1/chat/'):
        if request.headers.get('origin') not in (None, *TRUSTED_WEB_ORIGINS):
            return Response('Untrusted request origin', status_code=403)
        if request.headers.get('X-AgentForge-Client') != 'dashboard' and not request.headers.get('authorization', '').startswith('Bearer '):
            return Response('Missing dashboard request header', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if request.url.path.startswith('/api/v1/public/') or request.url.path.startswith('/api/v1/chat/') or request.url.path == '/widget.js':
        if request.url.path.startswith('/api/v1/chat/') and request.headers.get('origin') == WEB_ORIGIN:
            response.headers['Access-Control-Allow-Origin'] = WEB_ORIGIN
            response.headers['Access-Control-Allow-Credentials'] = 'true'
        else:
            response.headers['Access-Control-Allow-Origin'] = '*'
            if 'Access-Control-Allow-Credentials' in response.headers: del response.headers['Access-Control-Allow-Credentials']
    return response

class AuthInput(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    name: str = Field(default='Builder', min_length=1, max_length=80)
    @field_validator('name')
    @classmethod
    def clean_name(cls,value):
        if not value.strip(): raise ValueError('Name cannot be blank.')
        return value.strip()
    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value): raise ValueError('Enter a valid email address.')
        return value.strip().lower()

class BotInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=500)
    @field_validator('name')
    @classmethod
    def clean_name(cls,value):
        if not value.strip(): raise ValueError('Name cannot be blank.')
        return value.strip()

class BotUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=3000)
    threshold: float | None = Field(default=None, ge=0.05, le=0.95)
    published: bool | None = None
    widget_config: dict | None = None
    @field_validator('name')
    @classmethod
    def clean_name(cls,value):
        if value is not None and not value.strip(): raise ValueError('Name cannot be blank.')
        return value.strip() if value is not None else None
    @field_validator('widget_config')
    @classmethod
    def config(cls, value):
        if value is None: return value
        color = value.get('color', '#d6ff63')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError('Color must be a hex color.')
        if value.get('position', 'right') not in ('left', 'right'): raise ValueError('Position must be left or right.')
        greeting = str(value.get('greeting', 'Hi! How can I help?'))[:500]
        logo = str(value.get('logo', ''))[:2000]
        if logo and not logo.startswith('https://'): raise ValueError('Logo must use HTTPS.')
        return {'color': color, 'position': value.get('position', 'right'), 'greeting': greeting, 'logo': logo}

class SourceInput(BaseModel):
    name: str = Field(default='Knowledge note', min_length=1, max_length=200)
    content: str = Field(default='', max_length=2_000_000)
    url: str | None = Field(default=None, max_length=2000)

class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    visitor_id: str = Field(min_length=8, max_length=100)
    conversation_id: str | None = Field(default=None, max_length=50)
    @field_validator('message')
    @classmethod
    def clean_message(cls,value):
        if not value.strip(): raise ValueError('Message cannot be blank.')
        return value.strip()

class FixInput(BaseModel):
    answer: str = Field(min_length=10, max_length=10000)

class KeyInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)

class ProfileInput(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    company:str=Field(default='',max_length=120)
    bio:str=Field(default='',max_length=500)
    avatar_url:str=Field(default='',max_length=2000)
    @field_validator('name')
    @classmethod
    def name_required(cls,value):
        if not value.strip(): raise ValueError('Name cannot be blank.')
        return value.strip()
    @field_validator('avatar_url')
    @classmethod
    def avatar_https(cls,value):
        if value and not value.startswith('https://'): raise ValueError('Profile images must use HTTPS.')
        return value

def user_data(user):
    return {'id': user.id, 'email': user.email, 'name': user.name, 'plan': user.plan,'avatar_url':user.avatar_url or '', 'company':user.company or '', 'bio':user.bio or '', 'google_connected':bool(user.google_sub),'created_at':user.created_at,'is_active':bool(user.is_active),'is_admin':bool(os.getenv('ADMIN_USER_ID', '').strip() and user.id == os.getenv('ADMIN_USER_ID', '').strip()),'billing_provider':user.billing_provider}

def bot_data(bot, db):
    return {key: getattr(bot, key) for key in ('id', 'name', 'description', 'slug', 'public_key', 'system_prompt', 'widget_config', 'threshold', 'created_at')} | {'published':bool(bot.published),'documents': db.query(Document).filter_by(bot_id=bot.id).count(), 'messages': db.query(Message).filter_by(bot_id=bot.id, role='assistant').count()}

def doc_data(doc):
    return {key: getattr(doc, key) for key in ('id', 'name', 'source_type', 'source_uri', 'status', 'error', 'chunk_count', 'created_at')}

def set_session(response, db, user):
    token = secrets.token_urlsafe(48)
    seconds = int(os.getenv('SESSION_DAYS', '7')) * 86400
    db.add(LoginSession(token_hash=digest(token), user_id=user.id, expires_at=time.time() + seconds))
    db.commit()
    response.set_cookie('agentforge_session', token, max_age=seconds, httponly=True, secure=PRODUCTION, samesite='lax', path='/')

def check_document_quota(db, user, extra=1):
    db.execute(update(User).where(User.id == user.id).values(plan=User.plan))
    total = db.query(Document).join(Bot, Document.bot_id == Bot.id).filter(Bot.user_id == user.id).count()
    if total + extra > PLANS[user.plan]['documents']: raise HTTPException(403, 'Document limit reached. Upgrade your plan to add more sources.')

@app.get('/health')
def health(): return {'status': 'ok', 'generation': 'openai' if os.getenv('OPENAI_API_KEY') else 'local-extractive'}

@app.get('/api/v1/demo/pricing', tags=['demo'])
def demo_pricing():
    if PRODUCTION: raise HTTPException(404, 'Not found.')
    return {'demo':True,'currency':'INR','plans':[
        {'id':'demo-basic','name':'Basic (demo)','amount':0,'interval':'month'},
        {'id':'demo-pro','name':'Pro (demo)','amount':499,'interval':'month'},
        {'id':'demo-team','name':'Team (demo)','amount':1499,'interval':'month'},
    ]}

@app.post('/api/v1/auth/register', status_code=201)
def register(body: AuthInput, request: Request, response: Response, db: DBSession = Depends(get_db)):
    rate_limit(db, 'register:' + (request.client.host if request.client else 'unknown'), 10, 3600)
    user = User(email=body.email, name=body.name.strip(), password=password_hash(body.password))
    db.add(user)
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'An account already exists with this email.')
    set_session(response, db, user)
    return user_data(user)

@app.post('/api/v1/auth/login')
def login(body: AuthInput, request: Request, response: Response, db: DBSession = Depends(get_db)):
    rate_limit(db, 'login:' + (request.client.host if request.client else 'unknown'), 20, 900)
    user = db.query(User).filter_by(email=body.email).first()
    if not user or not verify_password(body.password, user.password): raise HTTPException(401, 'Email or password is incorrect.')
    if not user.is_active: raise HTTPException(403, 'This account has been suspended. Contact support.')
    set_session(response, db, user)
    return user_data(user)

@app.post('/api/v1/auth/logout')
def logout(request: Request, response: Response, db: DBSession = Depends(get_db)):
    token = request.cookies.get('agentforge_session')
    if token: db.query(LoginSession).filter_by(token_hash=digest(token)).delete()
    db.commit()
    response.delete_cookie('agentforge_session', path='/')
    return {'ok': True}

@app.get('/api/v1/auth/me')
def me(user=Depends(current_user)): return user_data(user)

@app.patch('/api/v1/account/profile')
def profile(body:ProfileInput,db:DBSession=Depends(get_db),user=Depends(current_user)):
    for key,value in body.model_dump().items(): setattr(user,key,value)
    db.commit()
    return user_data(user)

@app.get('/api/v1/bots')
def list_bots(db: DBSession = Depends(get_db), user=Depends(current_user)):
    return [bot_data(bot, db) for bot in db.query(Bot).filter_by(user_id=user.id).order_by(Bot.created_at.desc()).all()]

@app.post('/api/v1/bots', status_code=201)
def create_bot(body: BotInput, db: DBSession = Depends(get_db), user=Depends(current_user)):
    db.execute(update(User).where(User.id == user.id).values(plan=User.plan))
    if db.query(Bot).filter_by(user_id=user.id).count() >= PLANS[user.plan]['bots']: raise HTTPException(403, 'Agent limit reached. Upgrade your plan to create more agents.')
    slug = (re.sub(r'[^a-z0-9]+', '-', body.name.lower()).strip('-') or 'agent') + '-' + secrets.token_hex(3)
    bot = Bot(user_id=user.id, name=body.name.strip(), description=body.description, slug=slug)
    db.add(bot)
    db.commit()
    record_bot_log(db,bot.id,'dashboard',None,{'event_type':'agent_created','severity':'info','title':'Agent created','details':{'name':bot.name}})
    return bot_data(bot, db)

@app.get('/api/v1/bots/{bot_id}/identity-suggestions')
def identity_suggestions(bot_id:str, db:DBSession=Depends(get_db),user=Depends(current_user)):
    bot=owned_bot(db,bot_id,user)
    source=db.query(Document).filter_by(bot_id=bot_id,status='READY').first()
    subject=re.sub(r'\.(pdf|docx|txt|md)$','',source.name,flags=re.I) if source else bot.name
    return {'name':subject[:65]+' assistant','system_prompt':f'You are a helpful assistant for {subject}. Answer concisely using the source documents, cite your evidence, and say when information is unavailable.','greeting':f'Hi! Ask me anything about {subject}.'}

@app.get('/api/v1/bots/{bot_id}')
def get_bot(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    return bot_data(owned_bot(db, bot_id, user), db)

@app.patch('/api/v1/bots/{bot_id}')
def update_bot(bot_id: str, body: BotUpdate, db: DBSession = Depends(get_db), user=Depends(current_user)):
    bot = owned_bot(db, bot_id, user)
    updates=body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if value is not None: setattr(bot, key, value)
    db.commit()
    if updates: record_bot_log(db,bot_id,'dashboard',None,{'event_type':'agent_settings','severity':'info','title':'Agent settings updated','details':{'fields':sorted(updates.keys())}})
    return bot_data(bot, db)

@app.delete('/api/v1/bots/{bot_id}')
def delete_bot(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    bot = owned_bot(db, bot_id, user)
    for model in (Message, Flag, EvalRun, Chunk, Document, WorkflowApiLog, BotActivityLog, Conversation, Workflow): db.query(model).filter_by(bot_id=bot.id).delete()
    db.delete(bot)
    db.commit()
    return {'ok': True}

@app.get('/api/v1/bots/{bot_id}/documents')
def documents(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    return [doc_data(d) for d in db.query(Document).filter_by(bot_id=bot_id).order_by(Document.created_at.desc()).all()]

@app.post('/api/v1/bots/{bot_id}/documents', status_code=202)
def add_document(bot_id: str, body: SourceInput, tasks: BackgroundTasks, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    check_document_quota(db, user)
    if not body.url and not body.content.strip(): raise HTTPException(422, 'Add text or a website URL.')
    doc = Document(bot_id=bot_id, name=body.name, content=body.content, source_type='url' if body.url else 'text', source_uri=body.url or '')
    db.add(doc)
    db.commit()
    dispatch(tasks, doc.id)
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'knowledge_source','severity':'info','title':'Knowledge source added','details':{'document_id':doc.id,'name':doc.name,'source_type':doc.source_type}})
    return doc_data(doc)

@app.post('/api/v1/bots/{bot_id}/documents/upload', status_code=202)
async def upload_document(bot_id: str, tasks: BackgroundTasks, file: UploadFile = File(...), db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    check_document_quota(db, user)
    raw = await file.read(MAX_BYTES + 1)
    name = Path(file.filename or 'document.txt').name[:200]
    try: text = await asyncio.to_thread(parse_file, name, raw)
    except Exception as error:
        record_bot_log(db,bot_id,'dashboard',None,{'event_type':'error','severity':'error','title':'Knowledge file could not be read','details':{'name':name,'error_type':type(error).__name__}})
        raise HTTPException(422, 'Invalid document. Use a readable PDF, DOCX, TXT, or Markdown file under 10 MB.')
    doc = Document(bot_id=bot_id, name=name, content=text, source_type=name.rsplit('.', 1)[-1].lower())
    db.add(doc)
    db.commit()
    if os.getenv('S3_BUCKET'):
        try:
            doc.source_uri = await asyncio.to_thread(store_raw, doc.id, name, raw)
            db.commit()
        except Exception:
            logging.getLogger('agentforge').exception('S3 raw upload failed for document %s', doc.id)
            db.delete(doc)
            db.commit()
            record_bot_log(db,bot_id,'dashboard',None,{'event_type':'error','severity':'error','title':'Raw file storage failed','details':{'document_id':doc.id,'name':name,'stage':'s3_upload'}})
            raise HTTPException(502, 'Raw file storage failed. Please try again.')
    dispatch(tasks, doc.id)
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'knowledge_source','severity':'info','title':'Knowledge file uploaded','details':{'document_id':doc.id,'name':name,'bytes':len(raw),'status':doc.status}})
    return doc_data(doc)

@app.delete('/api/v1/bots/{bot_id}/documents/{doc_id}')
def delete_document(bot_id: str, doc_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    doc = db.query(Document).filter_by(id=doc_id, bot_id=bot_id).first()
    if not doc: raise HTTPException(404, 'Document not found.')
    deleted_name=doc.name
    db.query(Chunk).filter_by(document_id=doc_id).delete()
    db.delete(doc)
    db.flush()
    eval_bot(db, bot_id)
    db.commit()
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'knowledge_source','severity':'info','title':'Knowledge source deleted','details':{'document_id':doc_id,'name':deleted_name}})
    return {'ok': True}

@app.post('/api/v1/bots/{bot_id}/retrain', status_code=202)
def retrain(bot_id: str, tasks: BackgroundTasks, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    docs = db.query(Document).filter_by(bot_id=bot_id).all()
    for doc in docs:
        doc.status = 'PENDING'
    db.commit()
    for doc in docs: dispatch(tasks, doc.id)
    record_bot_log(db,bot_id,'dashboard',None,{'event_type':'knowledge_source','severity':'info','title':'Knowledge sources queued for reindexing','details':{'source_count':len(docs)}})
    return {'queued': len(docs)}

@app.get('/api/v1/public/bots/{slug}')
def public_bot(slug: str, db: DBSession = Depends(get_db)):
    bot = db.query(Bot).filter_by(slug=slug, published=1).first()
    if not bot: raise HTTPException(404, 'This agent is not published.')
    return {key: getattr(bot, key) for key in ('name', 'description', 'public_key', 'widget_config')}

@app.get('/api/v1/public/widget/{key}')
def widget_config(key: str, db: DBSession = Depends(get_db)):
    bot = db.query(Bot).filter_by(public_key=key, published=1).first()
    if not bot: raise HTTPException(404, 'This agent is not published.')
    return {'name': bot.name, 'chat_url': PUBLIC_WEB_URL + '/chat/' + bot.slug, 'widget_config': bot.widget_config}

@app.options('/api/v1/chat/{key}')
def chat_options(key: str):
    return Response(headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})

AGENT_IDENTITY_QUESTION = re.compile(r"\b(?:who\s+are\s+you|what\s+is\s+your\s+name|what's\s+your\s+name|what\s+are\s+you|introduce\s+yourself|tell\s+me\s+about\s+yourself|what\s+do\s+you\s+do|what\s+can\s+you\s+(?:do|help\s+with))\b", re.I)

def agent_identity_answer(bot, message):
    if not AGENT_IDENTITY_QUESTION.search(message): return None
    name = (bot.name or 'this assistant').strip()
    description = (bot.description or '').strip()
    if description:
        return f"I'm {name}, an AI assistant. {description}"
    return f"I'm {name}, an AI assistant. I answer questions using the knowledge sources connected to this agent."

@app.post('/api/v1/chat/{key}')
async def chat(key: str, body: ChatInput, request: Request, db: DBSession = Depends(get_db)):
    bot = db.query(Bot).filter_by(public_key=key).first()
    if not bot: raise HTTPException(404, 'Agent not found.')
    if not bot.published:
        user = current_user(request, db)
        if user.id != bot.user_id: raise HTTPException(404, 'Agent not found.')
    rate_limit(db, f'chat:{key}:{request.client.host if request.client else "unknown"}', 30)
    user = db.get(User, bot.user_id)
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    # Serialize quota accounting for a tenant on Postgres; SQLite serializes writers.
    db.execute(update(User).where(User.id == user.id).values(plan=User.plan))
    count = db.query(Message).join(Bot, Message.bot_id == Bot.id).filter(Bot.user_id == user.id, Message.role == 'user', Message.created_at.startswith(month)).count()
    if count >= PLANS[user.plan]['messages']: raise HTTPException(429, 'This agent has reached its monthly message limit.')
    conversation = None
    if body.conversation_id:
        conversation = db.query(Conversation).filter_by(id=body.conversation_id, bot_id=bot.id, visitor_id=body.visitor_id).first()
        if not conversation: raise HTTPException(404, 'Conversation not found.')
    if not conversation:
        conversation = Conversation(bot_id=bot.id, visitor_id=body.visitor_id)
        db.add(conversation)
        db.flush()
    history = db.query(Message).filter_by(conversation_id=conversation.id).order_by(Message.created_at.desc()).limit(40).all()[::-1]
    db.add(Message(conversation_id=conversation.id, bot_id=bot.id, role='user', content=body.message))
    db.commit()
    record_bot_log(db,bot.id,'chat',conversation.id,{'event_type':'message_received','severity':'info','title':'Visitor message received','details':{'message_length':len(body.message),'workflow_enabled':bool(db.query(Workflow).filter_by(bot_id=bot.id,enabled=1).first())}})
    start = time.perf_counter()
    blocked = bool(INJECTION.search(body.message))
    identity_answer = None if blocked else agent_identity_answer(bot, body.message)
    workflow_result=None
    workflow=db.query(Workflow).filter_by(bot_id=bot.id,enabled=1).first()
    if workflow and workflow.published_graph and not blocked and not identity_answer:
        from .workflow import run_graph,knowledge_answer
        state=conversation.workflow_state or {}
        if state.get('version')!=workflow.version: state={}
        workflow_result=await run_graph(workflow.published_graph,body.message,state,lambda q:knowledge_answer(db,bot,q),api_log=lambda event:record_api_log(db,bot.id,'chat',conversation.id,event),activity_log=lambda event:record_bot_log(db,bot.id,'chat',conversation.id,event))
        conversation.workflow_state=workflow_result['state']|{'version':workflow.version}
        db.commit()
    try: hits = [] if blocked or workflow_result or identity_answer else await hybrid_search(db, bot.id, body.message)
    except (httpx.HTTPError, ValueError) as error:
        record_bot_log(db,bot.id,'chat',conversation.id,{'event_type':'error','severity':'error','title':'Knowledge retrieval failed','details':{'error_type':type(error).__name__}})
        raise HTTPException(502, 'Retrieval provider is unavailable. Please try again.')
    try: hits = await rerank(body.message, hits)
    except httpx.HTTPError: hits = hits[:8]
    hits = [h for h in hits if h['confidence'] >= min(0.12, bot.threshold)]
    confidence = 1.0 if identity_answer else max((h['confidence'] for h in hits), default=0)
    abstain = blocked or (not identity_answer and confidence < bot.threshold)
    citations = [{'id': h['chunk'].id, 'index': i+1, 'document_id': h['chunk'].document_id, 'source': db.get(Document, h['chunk'].document_id).name, 'excerpt': h['chunk'].content[:500]} for i, h in enumerate(hits)] if not abstain else []
    if workflow_result:
        confidence=workflow_result['confidence'];citations=workflow_result['citations'];abstain=workflow_result['abstained']
    elif not blocked:
        record_bot_log(db,bot.id,'chat',conversation.id,{'event_type':'knowledge_search','severity':'warning' if abstain else 'info','title':'Knowledge search completed','details':{'result_count':len(hits),'confidence':round(confidence,4),'citation_count':len(citations),'abstained':abstain,'identity_response':bool(identity_answer)}})
    else:
        record_bot_log(db,bot.id,'chat',conversation.id,{'event_type':'error','severity':'warning','title':'Message blocked by safety rules','details':{'reason':'prompt_injection'}})
    conv_id, bot_id, system_prompt = conversation.id, bot.id, bot.system_prompt
    db.close()
    async def stream():
        def event(kind, data): return f'event: {kind}\ndata: {json.dumps(data)}\n\n'
        yield event('meta', {'conversation_id': conv_id, 'confidence': round(confidence, 3), 'citations': citations})
        try:
            if identity_answer:
                answer=identity_answer;model='agent-profile';tokens=len(answer.split());cost=0
                for piece in re.findall(r'\S+\s*|\s+',answer):
                    yield event('token',{'text':piece})
                    await asyncio.sleep(0.005)
            elif workflow_result:
                answer=workflow_result['answer'];model=workflow_result['model'];tokens=workflow_result['tokens'] or len(answer.split());cost=workflow_result['cost']
                yield event('workflow', {'trace':workflow_result['trace']})
                for piece in re.findall(r'\S+\s*|\s+',answer):
                    yield event('token',{'text':piece})
                    await asyncio.sleep(0.005)
            elif abstain:
                answer = "I can't follow instructions that override my safety rules. Please ask a question about the documents." if blocked else "I don't know based on the available documents. Add a source covering this question or contact the agent owner."
                model, tokens, cost = 'guardrail', len(answer.split()), 0
                for piece in re.findall(r'\S+\s*|\s+', answer):
                    yield event('token', {'text':piece})
                    await asyncio.sleep(0.005)
            else:
                answer,model,tokens,cost = '', 'unknown',0,0
                async for kind, data in generate_stream(body.message, hits, system_prompt, history):
                    if kind == 'token':
                        answer += data
                        yield event('token', {'text':data})
                        await asyncio.sleep(0.005)
                    else: model,tokens,cost = data['model'],data['tokens'],data['cost']
            latency = int((time.perf_counter() - start) * 1000)
            with Session() as store:
                stored = Message(bot_id=bot_id, conversation_id=conv_id, role='assistant', content=answer, citations=citations, confidence=confidence, tokens=tokens, cost_cents=cost, latency_ms=latency, trace={'model': model, 'abstained': abstain, 'blocked': blocked,'workflow':workflow_result['trace'] if workflow_result else [], 'retrieval': [{'chunk_id': h['chunk'].id, 'bm25': h['bm25'], 'cosine': h['cosine'], 'confidence': h['confidence']} for h in hits]})
                store.add(stored)
                from .rag import words
                evidence_words = set(words(' '.join(h['chunk'].content for h in hits)))
                answer_words = set(words(answer))
                support = len(answer_words & evidence_words) / max(len(answer_words),1)
                missing_citations = bool(hits) and not re.search(r'\[\d+\]',answer)
                reason = 'prompt_injection' if blocked else 'no_answer' if abstain or re.search(r"\b(I don't know|I do not know)\b",answer,re.I) else 'possible_hallucination' if not identity_answer and not workflow_result and model != 'local-extractive' and (support < 0.25 or missing_citations) else 'low_confidence' if confidence < 0.5 else 'negative_sentiment' if re.search(r'\b(angry|useless|terrible|frustrated|hate)\b', body.message, re.I) else None
                if reason: store.add(Flag(bot_id=bot_id, question=body.message, reason=reason))
                store.commit()
                record_bot_log(store,bot_id,'chat',conv_id,{'event_type':'assistant_response','severity':'warning' if abstain else 'info','title':'Agent response sent','details':{'model':model,'latency_ms':latency,'tokens':tokens,'confidence':round(confidence,4),'citation_count':len(citations),'abstained':abstain}})
                trace_id = stored.id
            await export_trace(trace_id, bot_id, body.message, answer, {'model':model,'tokens':tokens,'cost_cents':cost,'latency_ms':latency,'confidence':confidence,'abstained':abstain})
            yield event('done', {'tokens': tokens, 'cost_cents': cost, 'latency_ms': latency, 'model': model, 'abstained': abstain})
        except Exception as error:
            with Session() as log_db:
                record_bot_log(log_db,bot_id,'chat',conv_id,{'event_type':'error','severity':'error','title':'Chat response failed','details':{'error_type':type(error).__name__}})
            yield event('error', {'message': 'The response could not be completed. Please try again.'})
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

import httpx

@app.get('/api/v1/bots/{bot_id}/conversations')
def conversations(bot_id: str, page: int = 1, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    query = db.query(Conversation).filter_by(bot_id=bot_id)
    items = query.order_by(Conversation.created_at.desc()).offset((max(page, 1)-1)*20).limit(20).all()
    return {'total': query.count(), 'items': [{'id': c.id, 'visitor_id': c.visitor_id, 'created_at': c.created_at, 'messages': [{key: getattr(m, key) for key in ('id', 'role', 'content', 'citations', 'trace', 'confidence', 'tokens', 'cost_cents', 'latency_ms', 'created_at')} for m in db.query(Message).filter_by(conversation_id=c.id).order_by(Message.created_at).all()]} for c in items]}

@app.get('/api/v1/bots/{bot_id}/analytics/summary')
def analytics(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    messages = db.query(Message).filter_by(bot_id=bot_id, role='assistant').all()
    n = len(messages)
    days = {}
    for msg in messages: days[msg.created_at[:10]] = days.get(msg.created_at[:10], 0) + 1
    latencies = sorted(m.latency_ms for m in messages)
    return {'messages': n, 'conversations': db.query(Conversation).filter_by(bot_id=bot_id).count(), 'avg_confidence': sum(m.confidence for m in messages)/n if n else 0, 'abstain_rate': sum(bool(m.trace.get('abstained')) for m in messages)/n if n else 0, 'cost_cents': sum(m.cost_cents for m in messages), 'tokens': sum(m.tokens for m in messages), 'p95_latency_ms': latencies[min(n-1, int(n*0.95))] if n else 0, 'daily': [{'date': date, 'messages': count} for date, count in sorted(days.items())], 'open_flags': db.query(Flag).filter_by(bot_id=bot_id, status='open').count()}

@app.get('/api/v1/bots/{bot_id}/flags')
def flags(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    return [{key: getattr(f, key) for key in ('id', 'question', 'reason', 'status', 'created_at')} for f in db.query(Flag).filter_by(bot_id=bot_id).order_by(Flag.created_at.desc()).limit(100).all()]

@app.post('/api/v1/bots/{bot_id}/flags/{flag_id}/fix', status_code=202)
def fix_flag(bot_id: str, flag_id: str, body: FixInput, tasks: BackgroundTasks, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    flag = db.query(Flag).filter_by(id=flag_id, bot_id=bot_id).first()
    if not flag: raise HTTPException(404, 'Question not found.')
    check_document_quota(db, user)
    doc = Document(bot_id=bot_id, name='Answer: ' + flag.question[:80], content=f'Question: {flag.question}\nAnswer: {body.answer}')
    flag.status = 'resolved'
    db.add(doc)
    db.commit()
    dispatch(tasks, doc.id)
    return doc_data(doc)

@app.get('/api/v1/bots/{bot_id}/evals')
def evals(bot_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    owned_bot(db, bot_id, user)
    return [{key: getattr(e, key) for key in ('id', 'score_faithfulness', 'score_relevancy', 'sample_size', 'details', 'created_at','method')} for e in db.query(EvalRun).filter_by(bot_id=bot_id).order_by(EvalRun.created_at.desc()).limit(20).all()]

@app.get('/api/v1/account/usage')
def usage(db: DBSession = Depends(get_db), user=Depends(current_user)):
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    selected_provider = get_payment_provider(db)
    user_has_subscription = bool(user.plan != 'free' and ((user.billing_provider == 'stripe' and user.stripe_customer_id and user.subscription_id) or (user.billing_provider == 'razorpay' and user.razorpay_subscription_id)))
    billing_provider = user.billing_provider if user_has_subscription else selected_provider
    return {'plan': user.plan, 'limits': PLANS[user.plan], 'bots': db.query(Bot).filter_by(user_id=user.id).count(), 'documents': db.query(Document).join(Bot).filter(Bot.user_id == user.id).count(), 'messages': db.query(Message).join(Bot).filter(Bot.user_id == user.id, Message.role == 'user', Message.created_at.startswith(month)).count(), 'billing_configured': payment_provider_status()[selected_provider]['configured'], 'has_subscription': user_has_subscription, 'payment_provider': billing_provider}

@app.get('/api/v1/account/keys')
def keys(db: DBSession = Depends(get_db), user=Depends(current_user)):
    return [{'id': k.id, 'name': k.name, 'prefix': k.prefix, 'created_at': k.created_at} for k in db.query(ApiKey).filter_by(user_id=user.id).all()]

@app.post('/api/v1/account/keys', status_code=201)
def create_key(body: KeyInput, db: DBSession = Depends(get_db), user=Depends(current_user)):
    if db.query(ApiKey).filter_by(user_id=user.id).count() >= 10: raise HTTPException(403, 'Maximum of 10 API keys allowed.')
    token = 'af_' + secrets.token_urlsafe(32)
    key = ApiKey(user_id=user.id, name=body.name, key_hash=digest(token), prefix=token[:10])
    db.add(key)
    db.commit()
    return {'id': key.id, 'key': token, 'name': key.name, 'prefix': key.prefix}

@app.delete('/api/v1/account/keys/{key_id}')
def revoke_key(key_id: str, db: DBSession = Depends(get_db), user=Depends(current_user)):
    db.query(ApiKey).filter_by(id=key_id, user_id=user.id).delete()
    db.commit()
    return {'ok': True}

@app.get('/widget.js')
def widget():
    return FileResponse(Path(__file__).resolve().parents[2] / 'apps/widget/widget.js', media_type='application/javascript', headers={'Cache-Control': 'public, max-age=300'})

@app.get('/widget-preview/{key}', response_class=HTMLResponse)
def widget_preview(key:str, db:DBSession=Depends(get_db)):
    bot=db.query(Bot).filter_by(public_key=key,published=1).first()
    if not bot: raise HTTPException(404,'This agent is not published.')
    return HTMLResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentForge widget preview</title></head><body style="background:#f4f7ed;font-family:Arial,sans-serif;color:#34452c;padding:8vw"><p style="font-size:12px;letter-spacing:2px">AGENTFORGE EMBED PREVIEW</p><h1 style="font-size:48px;max-width:550px">Your agent. On any website.</h1><p style="max-width:480px;line-height:1.7">Open the chat button in the corner to test the standalone embed script. This page uses only vanilla JavaScript and a Web Component.</p><script src="/widget.js" data-agent-key="'+bot.public_key+'" async></script></body></html>')
