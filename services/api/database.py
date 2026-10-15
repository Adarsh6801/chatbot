import uuid
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import create_engine, Column, String, Text, Float, Integer, ForeignKey, JSON
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import UserDefinedType
from .config import DATABASE_URL

if DATABASE_URL.startswith('sqlite:///') and ':memory:' not in DATABASE_URL:
    Path(DATABASE_URL.removeprefix('sqlite:///')).parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(DATABASE_URL, connect_args={'check_same_thread': False, 'timeout': 30} if DATABASE_URL.startswith('sqlite') else {}, pool_pre_ping=True, **({'poolclass': StaticPool} if ':memory:' in DATABASE_URL else {}))
Session = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()

class Vector(UserDefinedType):
    cache_ok = True
    def get_col_spec(self, **kw): return 'vector(256)'
    def bind_processor(self, dialect):
        import json
        return lambda value: json.dumps(value)
    def result_processor(self, dialect, coltype):
        import json
        return lambda value: json.loads(value) if isinstance(value, str) else list(value)

vector_type = Vector().with_variant(JSON(), 'sqlite')

def uid(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc).isoformat()

class User(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True, default=uid)
    email = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    password = Column(String, nullable=False)
    plan = Column(String, default='free', nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    subscription_id = Column(String, nullable=True)
    avatar_url = Column(Text, default='')
    bio = Column(Text, default='')
    company = Column(String, default='')
    google_sub = Column(String, unique=True, nullable=True)
    created_at = Column(String, default=now)

class LoginSession(Base):
    __tablename__ = 'sessions'
    token_hash = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=False, index=True)
    expires_at = Column(Float, nullable=False)

class Bot(Base):
    __tablename__ = 'bots'
    id = Column(String, primary_key=True, default=uid)
    user_id = Column(String, ForeignKey('users.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    public_key = Column(String, unique=True, default=uid, nullable=False)
    description = Column(Text, default='')
    system_prompt = Column(Text, default='Answer clearly using only the provided sources. Cite your evidence.')
    widget_config = Column(JSON, default=lambda: {'color': '#d6ff63', 'position': 'right', 'greeting': 'Hi! What can I help you find?', 'logo': ''})
    threshold = Column(Float, default=0.22)
    published = Column(Integer, default=0)
    created_at = Column(String, default=now)

class Document(Base):
    __tablename__ = 'documents'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    source_type = Column(String, default='text')
    source_uri = Column(Text, default='')
    content = Column(Text, default='')
    status = Column(String, default='PENDING', nullable=False)
    error = Column(Text, nullable=True)
    chunk_count = Column(Integer, default=0)
    processing_at = Column(Float, default=0)
    created_at = Column(String, default=now)

class Chunk(Base):
    __tablename__ = 'chunks'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    document_id = Column(String, ForeignKey('documents.id'), nullable=False, index=True)
    content = Column(Text, nullable=False)
    embedding = Column(vector_type, nullable=False)
    embedding_model = Column(String, nullable=False, default='local:feature-hash-256')
    ordinal = Column(Integer, nullable=False)

class Conversation(Base):
    __tablename__ = 'conversations'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    visitor_id = Column(String, nullable=False)
    workflow_state = Column(JSON, default=dict)
    created_at = Column(String, default=now)

class Message(Base):
    __tablename__ = 'messages'
    id = Column(String, primary_key=True, default=uid)
    conversation_id = Column(String, ForeignKey('conversations.id'), nullable=False, index=True)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    citations = Column(JSON, default=list)
    trace = Column(JSON, default=dict)
    confidence = Column(Float, default=0)
    tokens = Column(Integer, default=0)
    cost_cents = Column(Float, default=0)
    latency_ms = Column(Integer, default=0)
    created_at = Column(String, default=now)

class Flag(Base):
    __tablename__ = 'flagged_queries'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    question = Column(Text, nullable=False)
    reason = Column(String, nullable=False)
    status = Column(String, default='open')
    created_at = Column(String, default=now)

class EvalRun(Base):
    __tablename__ = 'eval_runs'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, index=True)
    score_faithfulness = Column(Float, default=0)
    score_relevancy = Column(Float, default=0)
    sample_size = Column(Integer, default=0)
    details = Column(JSON, default=list)
    method = Column(String, default='extractive retrieval smoke test', nullable=False)
    created_at = Column(String, default=now)

class ApiKey(Base):
    __tablename__ = 'api_keys'
    id = Column(String, primary_key=True, default=uid)
    user_id = Column(String, ForeignKey('users.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    key_hash = Column(String, unique=True, nullable=False)
    prefix = Column(String, nullable=False)
    created_at = Column(String, default=now)

class RateBucket(Base):
    __tablename__ = 'rate_buckets'
    key = Column(String, primary_key=True)
    window = Column(Integer, nullable=False)
    count = Column(Integer, default=0, nullable=False)

class WebhookEvent(Base):
    __tablename__ = 'webhook_events'
    id = Column(String, primary_key=True)
    created_at = Column(String, default=now)

class Workflow(Base):
    __tablename__ = 'workflows'
    id = Column(String, primary_key=True, default=uid)
    bot_id = Column(String, ForeignKey('bots.id'), nullable=False, unique=True)
    draft = Column(JSON, nullable=False)
    published_graph = Column(JSON, nullable=True)
    enabled = Column(Integer, default=0)
    version = Column(Integer, default=0)
    updated_at = Column(String, default=now)

def get_db():
    with Session() as db:
        yield db
