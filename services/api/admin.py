"""Global platform administration endpoints, isolated from workspace APIs."""
import os, json, struct, asyncio, re, hashlib

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Request, Response, Query
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
import httpx
from datetime import datetime, timedelta, timezone

from .database import AdminAudit, AgentVersion, ApiKey, AppSetting, BillingAttempt, Bot, BotActivityLog, Chunk, Conversation, Document, DocumentationCategory, DocumentationPage, FaqItem, Flag, LoginSession, Message, Payment, SiteBotChunk, SiteBotConfig, SiteBotConversation, SiteBotKnowledge, SiteBotMessage, SiteBotWalkthrough, SitePage, SupportTicket, SupportTicketMessage, TokenUsage, User, Workflow, get_db, now, uid
from .ingestion import MAX_BYTES, parse_file
from .site_bot import (
    SiteBotConfigPatch,
    SiteBotKnowledgeInput,
    SiteBotKnowledgePatch,
    SiteBotWalkthroughInput,
    SiteBotWalkthroughPatch,
    index_site_knowledge,
    serialize_config as serialize_site_bot_config,
    serialize_knowledge as serialize_site_bot_knowledge,
    serialize_walkthrough as serialize_site_bot_walkthrough,
)
from .site_bot_seed import ensure_site_bot_seeded
from .site_pages import ensure_site_pages_seeded, serialize_faq, serialize_site_page
from .payment_settings import get_payment_provider, payment_provider_status
from .security import current_user
from .providers import store_site_logo, read_site_logo
from .plan_catalog import get_plan_catalog
from .chat_templates import get_templates, write_templates, normalize_theme, template_data

router = APIRouter(prefix="/api/v1/admin", tags=["platform administration"])


def require_admin(user: User = Depends(current_user)) -> User:
    admin_id = os.getenv("ADMIN_USER_ID", "").strip()
    if not admin_id or user.id != admin_id:
        raise HTTPException(403, "Global administrator access is not enabled for this account.")
    return user


def write_audit(db: Session, actor: User, action: str, entity_type: str, entity_id: str, details=None) -> None:
    db.add(AdminAudit(actor_id=actor.id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}))


class UserUpdate(BaseModel):
    plan: str | None = None
    is_active: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    company: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=500)
    avatar_url: str | None = Field(default=None, max_length=2000)
    subscription_tokens: int | None = Field(default=None, ge=0, le=100_000_000_000)
    topup_tokens: int | None = Field(default=None, ge=0, le=100_000_000_000)

    @field_validator('name')
    @classmethod
    def clean_user_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Name cannot be blank.')
        return value.strip() if value is not None else None

    @field_validator('avatar_url')
    @classmethod
    def valid_avatar_url(cls, value):
        if value is None:
            return None
        cleaned = value.strip()
        if cleaned and not cleaned.startswith('https://'):
            raise ValueError('Profile image URL must use HTTPS.')
        return cleaned


class UserAgentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=3000)
    threshold: float | None = Field(default=None, ge=0.05, le=0.95)
    published: bool | None = None

    @field_validator('name')
    @classmethod
    def clean_agent_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Agent name cannot be blank.')
        return value.strip() if value is not None else None


class AgentUpdate(BaseModel):
    published: bool


class PaymentProviderUpdate(BaseModel):
    provider: str

class TopupPackageWrite(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: int = Field(gt=0, le=100000000)
    tokens: int = Field(gt=0, le=10000000000)

class TopupPackagesUpdate(BaseModel):
    packages: list[TopupPackageWrite]

class ChatTemplateWrite(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=300)
    active: bool = True
    config: dict

    @field_validator('name')
    @classmethod
    def trim_template_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Template name cannot be blank.')
        return value

    @field_validator('description')
    @classmethod
    def trim_template_description(cls, value):
        return value.strip()

    @field_validator('config')
    @classmethod
    def clean_template_config(cls, value):
        return normalize_theme(value)

class PlanCatalogEntry(BaseModel):
    slug: str = Field(pattern=r'^[a-z][a-z0-9_-]{1,39}$')
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    bots: int = Field(ge=0, le=100000)
    documents: int = Field(ge=0, le=1000000)
    tokens: int = Field(ge=0, le=100000000000)
    stripe_price_id: str = Field(default='', max_length=200)
    stripe_product_id: str = Field(default='', max_length=200)
    stripe_interval: Literal['month','year'] = 'month'
    stripe_interval_count: int = Field(default=1, ge=1, le=12)
    stripe_amount: float | None = Field(default=None, ge=0)
    stripe_currency: str = Field(default='USD', min_length=3, max_length=3)
    razorpay_plan_id: str = Field(default='', max_length=200)
    razorpay_interval: Literal['month','year'] = 'month'
    razorpay_interval_count: int = Field(default=1, ge=1, le=12)
    razorpay_amount: float | None = Field(default=None, ge=0)
    razorpay_currency: str = Field(default='INR', min_length=3, max_length=3)

class PlanCatalogUpdate(BaseModel):
    plans: list[PlanCatalogEntry]

class FreePlanUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    bots: int = Field(ge=0, le=100000)
    documents: int = Field(ge=0, le=1000000)
    tokens: int = Field(ge=0, le=100000000000)

class ProviderPlanCreate(BaseModel):
    slug: str = Field(pattern=r'^[a-z][a-z0-9_-]{1,39}$')
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0, le=100000000)
    currency: str = Field(default='INR', min_length=3, max_length=3)
    interval: Literal['month','year'] = 'month'
    interval_count: int = Field(default=1, ge=1, le=12)
    bots: int = Field(ge=0, le=100000)
    documents: int = Field(ge=0, le=1000000)
    tokens: int = Field(gt=0, le=100000000000)


class SiteSettingsUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    logo: str | None = None
    brand_display: Literal["both", "image", "text"] | None = None

    @field_validator('name')
    @classmethod
    def clean_site_name(cls, value):
        if not value.strip(): raise ValueError('Application name cannot be blank.')
        return value.strip()


class SupportReply(BaseModel):
    message: str = Field(min_length=1, max_length=10000)


class SupportStatusUpdate(BaseModel):
    status: str


class DocumentationCategoryWrite(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=120)
    description: str = Field(default='', max_length=500)
    position: int = Field(default=0, ge=0, le=10000)

    @field_validator('title', 'slug', 'description')
    @classmethod
    def trim_documentation_category(cls, value):
        return value.strip()


class DocumentationPageWrite(BaseModel):
    category_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=1, max_length=180)
    summary: str = Field(default='', max_length=500)
    content: str = Field(min_length=1, max_length=100000)
    status: Literal['draft', 'published'] = 'draft'
    position: int = Field(default=0, ge=0, le=10000)

    @field_validator('title', 'slug', 'summary')
    @classmethod
    def trim_documentation_page(cls, value):
        return value.strip()

    @field_validator('content')
    @classmethod
    def validate_documentation_content(cls, value):
        if not value.strip(): raise ValueError('Article content cannot be blank.')
        return value.strip()


def normalize_docs_slug(value: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    if not slug or len(slug) > 180:
        raise HTTPException(422, 'Enter a valid URL slug using letters and numbers.')
    return slug


@router.get("/overview")
def overview(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    provider_status = payment_provider_status(db)
    return {
        "users": db.query(func.count(User.id)).scalar() or 0,
        "active_users": db.query(func.count(User.id)).filter(User.is_active == 1).scalar() or 0,
        "suspended_users": db.query(func.count(User.id)).filter(User.is_active == 0).scalar() or 0,
        "agents": db.query(func.count(Bot.id)).scalar() or 0,
        "published_agents": db.query(func.count(Bot.id)).filter(Bot.published == 1).scalar() or 0,
        "documents": db.query(func.count(Document.id)).scalar() or 0,
        "messages": db.query(func.count(Message.id)).filter(Message.role == "user").scalar() or 0,
        "plans": {plan: count for plan, count in db.query(User.plan, func.count(User.id)).group_by(User.plan).all()},
        "integrations": {
            "openai": bool(os.getenv("OPENAI_API_KEY")),
            "stripe": provider_status["stripe"]["configured"],
            "razorpay": provider_status["razorpay"]["configured"],
            "redis": bool(os.getenv("REDIS_URL")),
            "langfuse": bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")),
        },
    }


@router.get('/langfuse/observations')
async def langfuse_observations(cursor: str | None = None, limit: int = Query(50, ge=1, le=100), _admin: User = Depends(require_admin)):
    public, secret = os.getenv('LANGFUSE_PUBLIC_KEY'), os.getenv('LANGFUSE_SECRET_KEY')
    if not public or not secret:
        return {'configured': False, 'items': [], 'cursor': None}
    from datetime import datetime, timedelta, timezone
    now_utc = datetime.now(timezone.utc)
    params = {
        'fromStartTime': (now_utc - timedelta(days=90)).isoformat(),
        'toStartTime': now_utc.isoformat(),
        'isRootObservation': 'true',
        'fields': 'core,basic,io,metadata,model,usage,metrics,trace_context',
        'limit': limit,
    }
    if cursor: params['cursor'] = cursor
    url = os.getenv('LANGFUSE_HOST', 'https://cloud.langfuse.com').rstrip('/') + '/api/public/v2/observations'
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(url, params=params, auth=(public, secret))
            response.raise_for_status()
        body = response.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(502, 'Langfuse rejected the configured API keys. Check the project keys and read access.')
        raise HTTPException(502, f'Langfuse API returned HTTP {exc.response.status_code}.')
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Could not read observations from Langfuse. Check the host and network connection.')
    return {'configured': True, 'items': body.get('data', []), 'cursor': (body.get('meta') or {}).get('cursor')}


@router.get('/langfuse/metrics')
async def langfuse_metrics(from_timestamp: datetime, to_timestamp: datetime, _admin: User = Depends(require_admin)):
    public, secret = os.getenv('LANGFUSE_PUBLIC_KEY'), os.getenv('LANGFUSE_SECRET_KEY')
    if not public or not secret:
        return {'configured': False, 'summary': {}, 'by_model': [], 'daily': []}
    if from_timestamp.tzinfo is None or to_timestamp.tzinfo is None:
        raise HTTPException(422, 'Choose a date range with timezone-aware timestamps.')
    start = from_timestamp.astimezone(timezone.utc)
    end = to_timestamp.astimezone(timezone.utc)
    if start > end:
        raise HTTPException(422, 'Start date must be on or before the end date.')
    if end - start > timedelta(days=366):
        raise HTTPException(422, 'Choose a date range of 366 days or less.')

    root_filter = [{'column': 'isRootObservation', 'operator': '=', 'value': True, 'type': 'boolean'}]
    base = {'view': 'observations', 'filters': root_filter, 'fromTimestamp': start.isoformat(), 'toTimestamp': end.isoformat()}
    summary_query = {**base, 'metrics': [
        {'measure': 'count', 'aggregation': 'count'},
        {'measure': 'totalTokens', 'aggregation': 'sum'},
        {'measure': 'totalCost', 'aggregation': 'sum'},
        {'measure': 'latency', 'aggregation': 'avg'},
    ]}
    model_query = {**base, 'metrics': [
        {'measure': 'count', 'aggregation': 'count'},
        {'measure': 'totalTokens', 'aggregation': 'sum'},
        {'measure': 'totalCost', 'aggregation': 'sum'},
    ], 'dimensions': [{'field': 'providedModelName'}], 'config': {'row_limit': 100}}
    daily_query = {**base, 'metrics': [
        {'measure': 'count', 'aggregation': 'count'},
        {'measure': 'totalTokens', 'aggregation': 'sum'},
        {'measure': 'totalCost', 'aggregation': 'sum'},
    ], 'timeDimension': {'granularity': 'day'}, 'config': {'row_limit': 1000}}
    url = os.getenv('LANGFUSE_HOST', 'https://cloud.langfuse.com').rstrip('/') + '/api/public/v2/metrics'
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            responses = await asyncio.gather(*[
                client.get(url, params={'query': json.dumps(query)}, auth=(public, secret))
                for query in (summary_query, model_query, daily_query)
            ])
            for response in responses: response.raise_for_status()
        summary_rows, model_body, daily_body = [response.json() for response in responses]
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(502, 'Langfuse rejected the configured API keys. Check the project keys and read access.')
        raise HTTPException(502, f'Langfuse Metrics API returned HTTP {exc.response.status_code}.')
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Could not read metrics from Langfuse. Check the host and network connection.')

    summary = (summary_rows.get('data') or [{}])[0]
    return {
        'configured': True,
        'from_timestamp': start.isoformat(),
        'to_timestamp': end.isoformat(),
        'summary': {
            'requests': summary.get('count_count', 0) or 0,
            'total_tokens': summary.get('sum_totalTokens', 0) or 0,
            'total_cost': summary.get('sum_totalCost', 0) or 0,
            'avg_latency': summary.get('avg_latency', 0) or 0,
        },
        'by_model': model_body.get('data', []),
        'daily': daily_body.get('data', []),
    }


def admin_doc_page(page: DocumentationPage) -> dict:
    return {key: getattr(page, key) for key in ('id', 'category_id', 'title', 'slug', 'summary', 'content', 'status', 'position', 'created_at', 'updated_at')}


@router.get('/documentation')
def admin_documentation(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    categories = db.query(DocumentationCategory).order_by(DocumentationCategory.position, DocumentationCategory.title).all()
    pages = db.query(DocumentationPage).order_by(DocumentationPage.position, DocumentationPage.title).all()
    pages_by_category: dict[str, list[dict]] = {}
    for page in pages: pages_by_category.setdefault(page.category_id, []).append(admin_doc_page(page))
    return {'categories': [
        {'id': category.id, 'title': category.title, 'slug': category.slug,
         'description': category.description, 'position': category.position,
         'created_at': category.created_at, 'updated_at': category.updated_at,
         'pages': pages_by_category.get(category.id, [])}
        for category in categories
    ]}


@router.post('/documentation/categories', status_code=201)
def create_documentation_category(body: DocumentationCategoryWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not body.title.strip(): raise HTTPException(422, 'Section title cannot be blank.')
    slug = normalize_docs_slug(body.slug)
    if db.query(DocumentationCategory).filter_by(slug=slug).first(): raise HTTPException(409, 'A documentation section with this slug already exists.')
    category = DocumentationCategory(title=body.title.strip(), slug=slug, description=body.description.strip(), position=body.position)
    db.add(category); db.flush()
    write_audit(db, admin, 'documentation.category.created', 'documentation_category', category.id, {'title': category.title, 'slug': slug})
    db.commit()
    return {'id': category.id, 'title': category.title, 'slug': category.slug, 'description': category.description, 'position': category.position, 'pages': []}


@router.put('/documentation/categories/{category_id}')
def update_documentation_category(category_id: str, body: DocumentationCategoryWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    category = db.get(DocumentationCategory, category_id)
    if not category: raise HTTPException(404, 'Documentation section not found.')
    if not body.title.strip(): raise HTTPException(422, 'Section title cannot be blank.')
    slug = normalize_docs_slug(body.slug)
    if db.query(DocumentationCategory).filter(DocumentationCategory.slug == slug, DocumentationCategory.id != category_id).first(): raise HTTPException(409, 'A documentation section with this slug already exists.')
    changes = {'title': category.title != body.title.strip(), 'slug': category.slug != slug}
    category.title, category.slug, category.description, category.position, category.updated_at = body.title.strip(), slug, body.description.strip(), body.position, now()
    write_audit(db, admin, 'documentation.category.updated', 'documentation_category', category.id, changes)
    db.commit()
    return {'id': category.id, 'title': category.title, 'slug': category.slug, 'description': category.description, 'position': category.position}


@router.delete('/documentation/categories/{category_id}')
def delete_documentation_category(category_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    category = db.get(DocumentationCategory, category_id)
    if not category: raise HTTPException(404, 'Documentation section not found.')
    page_count = db.query(DocumentationPage).filter_by(category_id=category.id).count()
    db.query(DocumentationPage).filter_by(category_id=category.id).delete(synchronize_session=False)
    db.delete(category)
    write_audit(db, admin, 'documentation.category.deleted', 'documentation_category', category.id, {'title': category.title, 'pages_deleted': page_count})
    db.commit()
    return {'ok': True, 'deleted_pages': page_count}


@router.post('/documentation/pages', status_code=201)
def create_documentation_page(body: DocumentationPageWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not db.get(DocumentationCategory, body.category_id): raise HTTPException(422, 'Choose an existing documentation section.')
    if not body.title.strip(): raise HTTPException(422, 'Page title cannot be blank.')
    slug = normalize_docs_slug(body.slug)
    if db.query(DocumentationPage).filter_by(slug=slug).first(): raise HTTPException(409, 'A documentation page with this slug already exists.')
    page = DocumentationPage(category_id=body.category_id, title=body.title.strip(), slug=slug, summary=body.summary.strip(), content=body.content, status=body.status, position=body.position)
    db.add(page); db.flush()
    write_audit(db, admin, 'documentation.page.created', 'documentation_page', page.id, {'title': page.title, 'slug': slug, 'status': page.status})
    db.commit()
    return admin_doc_page(page)


@router.put('/documentation/pages/{page_id}')
def update_documentation_page(page_id: str, body: DocumentationPageWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    page = db.get(DocumentationPage, page_id)
    if not page: raise HTTPException(404, 'Documentation page not found.')
    if not body.title.strip(): raise HTTPException(422, 'Page title cannot be blank.')
    if not db.get(DocumentationCategory, body.category_id): raise HTTPException(422, 'Choose an existing documentation section.')
    slug = normalize_docs_slug(body.slug)
    if db.query(DocumentationPage).filter(DocumentationPage.slug == slug, DocumentationPage.id != page_id).first(): raise HTTPException(409, 'A documentation page with this slug already exists.')
    changes = {'title': page.title != body.title.strip(), 'slug': page.slug != slug, 'status': page.status != body.status, 'category_id': page.category_id != body.category_id}
    page.category_id, page.title, page.slug = body.category_id, body.title.strip(), slug
    page.summary, page.content, page.status, page.position, page.updated_at = body.summary.strip(), body.content, body.status, body.position, now()
    write_audit(db, admin, 'documentation.page.updated', 'documentation_page', page.id, changes)
    db.commit()
    return admin_doc_page(page)


@router.delete('/documentation/pages/{page_id}')
def delete_documentation_page(page_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    page = db.get(DocumentationPage, page_id)
    if not page: raise HTTPException(404, 'Documentation page not found.')
    write_audit(db, admin, 'documentation.page.deleted', 'documentation_page', page.id, {'title': page.title, 'slug': page.slug})
    db.delete(page); db.commit()
    return {'ok': True}


@router.get("/settings/payment-provider")
def get_payment_settings(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return {"provider": get_payment_provider(db), "providers": payment_provider_status(db)}


@router.get("/payments")
def payments(page: int = 1, limit: int = 25, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(Payment, User).join(User, Payment.user_id == User.id)
    total = query.count()
    records = query.order_by(Payment.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    items = [{"id": payment.id, "provider": payment.provider, "status": payment.status, "plan": payment.plan, "kind": payment.kind, "tokens": payment.tokens,
              "amount": payment.amount, "currency": payment.currency, "created_at": payment.created_at,
              "user_name": user.name, "user_email": user.email} for payment, user in records]
    return {"items": items, "total": total, "page": page, "limit": limit}

def _topup_catalog(db):
    setting = db.get(AppSetting, 'topup_packages')
    try: return json.loads(setting.value) if setting else []
    except (ValueError, TypeError): return []

@router.get('/topups')
def topups(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    rows = db.query(Payment, User).join(User, Payment.user_id == User.id).filter(Payment.kind == 'topup').order_by(Payment.created_at.desc()).limit(250).all()
    revenue = db.query(func.coalesce(func.sum(Payment.amount), 0)).filter(Payment.kind == 'topup', Payment.status.in_(['paid','captured'])).scalar() or 0
    return {'packages': _topup_catalog(db), 'transactions': [{'id': p.id, 'user_id': p.user_id, 'user_name': u.name, 'user_email': u.email, 'provider': p.provider, 'status': p.status, 'amount': p.amount, 'currency': p.currency, 'tokens': p.tokens, 'created_at': p.created_at} for p,u in rows], 'revenue': revenue}

@router.get('/plans')
def admin_plans(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return {'plans': get_plan_catalog(db)}

@router.get('/chat-templates')
def list_chat_templates(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return {'templates':[template_data(row) for row in get_templates(db)]}

@router.post('/chat-templates', status_code=201)
def create_chat_template(body: ChatTemplateWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    template = {'id':uid(),'name':body.name,'description':body.description,'active':body.active,'config':body.config}
    templates = get_templates(db)
    templates.append(template)
    write_templates(db, templates)
    write_audit(db, admin, 'chat_template.created', 'chat_template', template['id'], {'name':template['name']})
    db.commit()
    return {'template':template_data(template)}

@router.put('/chat-templates/{template_id}')
def update_chat_template(template_id: str, body: ChatTemplateWrite, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    templates = get_templates(db)
    template = next((row for row in templates if row.get('id') == template_id), None)
    if not template: raise HTTPException(404, 'Chat template not found.')
    before = template_data(template)
    template.update({'name':body.name,'description':body.description,'active':body.active,'config':body.config})
    write_templates(db, templates)
    write_audit(db, admin, 'chat_template.updated', 'chat_template', template_id, {'before':before,'after':template_data(template)})
    db.commit()
    return {'template':template_data(template)}

@router.delete('/chat-templates/{template_id}')
def delete_chat_template(template_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    templates = get_templates(db)
    template = next((row for row in templates if row.get('id') == template_id), None)
    if not template: raise HTTPException(404, 'Chat template not found.')
    templates = [row for row in templates if row.get('id') != template_id]
    write_templates(db, templates)
    write_audit(db, admin, 'chat_template.deleted', 'chat_template', template_id, {'name':template.get('name')})
    db.commit()
    return {'ok':True,'id':template_id}

@router.get('/plans/free')
def get_free_plan(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    plan = next((item for item in get_plan_catalog(db) if item.get('slug') == 'free'), None)
    if not plan: raise HTTPException(404, 'Free plan configuration not found.')
    return {'plan': plan}

@router.put('/plans/free')
def update_free_plan(body: FreePlanUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plans = get_plan_catalog(db)
    plan = next((item for item in plans if item.get('slug') == 'free'), None)
    if not plan: raise HTTPException(404, 'Free plan configuration not found.')
    before = {key: plan.get(key) for key in ('name', 'active', 'bots', 'documents', 'tokens')}
    plan.update(body.model_dump())
    _write_plan_catalog(db, plans)
    write_audit(db, admin, 'plan.free_updated', 'plan', 'free', {'before': before, 'after': body.model_dump()})
    db.commit()
    return {'plan': plan}

def _write_plan_catalog(db, plans):
    setting = db.get(AppSetting, 'plan_catalog')
    value = json.dumps(plans, separators=(',', ':'))
    if setting: setting.value, setting.updated_at = value, now()
    else: db.add(AppSetting(key='plan_catalog', value=value, updated_at=now()))

@router.get('/plans/provider/{provider}')
def list_provider_plans(provider: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    if provider not in ('stripe','razorpay'): raise HTTPException(404, 'Payment provider not found.')
    id_key='stripe_price_id' if provider=='stripe' else 'razorpay_plan_id'
    return {'provider':provider,'plans':[p for p in get_plan_catalog(db) if p.get(id_key)]}

@router.post('/plans/provider/{provider}', status_code=201)
def create_provider_plan(provider: str, body: ProviderPlanCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if provider not in ('stripe','razorpay'): raise HTTPException(404, 'Payment provider not found.')
    if body.slug == 'free': raise HTTPException(422, 'The Free plan does not use recurring checkout.')
    plans=get_plan_catalog(db)
    plan=next((p for p in plans if p['slug']==body.slug),None)
    if plan is None:
        plan={'slug':body.slug,'name':body.name,'active':True,'bots':body.bots,'documents':body.documents,'tokens':body.tokens,
              'stripe_price_id':'','stripe_product_id':'','stripe_interval':'month','stripe_interval_count':1,'stripe_amount':None,'stripe_currency':'USD',
              'razorpay_plan_id':'','razorpay_interval':'month','razorpay_interval_count':1,'razorpay_amount':None,'razorpay_currency':'INR'}
        plans.append(plan)
    else:
        plan.update({'name':body.name,'active':True,'bots':body.bots,'documents':body.documents,'tokens':body.tokens})
    currency=body.currency.upper()
    previous_provider_id=plan.get('stripe_price_id' if provider=='stripe' else 'razorpay_plan_id')
    try:
        if provider=='stripe':
            if not os.getenv('STRIPE_SECRET_KEY'): raise HTTPException(503,'Stripe secret key is not configured.')
            import stripe
            stripe.api_key=os.getenv('STRIPE_SECRET_KEY')
            product=stripe.Product.create(name=body.name,metadata={'plan_slug':body.slug})
            zero_decimal={'bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'}
            unit_amount=round(body.amount * (1 if currency.lower() in zero_decimal else 100))
            price=stripe.Price.create(product=product.id,unit_amount=unit_amount,currency=currency.lower(),recurring={'interval':body.interval,'interval_count':body.interval_count})
            plan.update({'stripe_price_id':price.id,'stripe_product_id':product.id,'stripe_amount':body.amount,'stripe_currency':currency,'stripe_interval':body.interval,'stripe_interval_count':body.interval_count})
            if previous_provider_id:
                try: stripe.Price.modify(previous_provider_id,active=False)
                except Exception: pass
        else:
            key_id,secret=os.getenv('RAZORPAY_KEY_ID'),os.getenv('RAZORPAY_KEY_SECRET')
            if not (key_id and secret): raise HTTPException(503,'Razorpay API credentials are not configured.')
            response=httpx.post('https://api.razorpay.com/v1/plans',auth=(key_id,secret),json={'period':'monthly' if body.interval=='month' else 'yearly','interval':body.interval_count,'item':{'name':body.name,'amount':round(body.amount*100),'currency':currency,'description':f'{body.name} subscription'},'notes':{'plan_slug':body.slug}},timeout=20)
            if response.status_code>=400: raise HTTPException(502,'Razorpay could not create the plan. Check the amount, currency, and API credentials.')
            result=response.json()
            if not result.get('id'): raise HTTPException(502,'Razorpay returned no plan ID.')
            plan.update({'razorpay_plan_id':result['id'],'razorpay_amount':body.amount,'razorpay_currency':currency,'razorpay_interval':body.interval,'razorpay_interval_count':body.interval_count})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502,f'{provider.title()} could not create the recurring plan. Check the provider dashboard and API credentials.') from exc
    _write_plan_catalog(db,plans)
    write_audit(db,admin,'plan.provider_created','plan',body.slug,{'provider':provider,'name':body.name,'provider_plan_id':plan.get('stripe_price_id' if provider=='stripe' else 'razorpay_plan_id')})
    db.commit()
    return {'provider':provider,'plan':plan}

@router.delete('/plans/provider/{provider}/{slug}')
def remove_provider_plan(provider: str, slug: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if provider not in ('stripe','razorpay'): raise HTTPException(404,'Payment provider not found.')
    plans=get_plan_catalog(db)
    plan=next((p for p in plans if p.get('slug')==slug),None)
    if not plan: raise HTTPException(404,'Plan not found.')
    id_key='stripe_price_id' if provider=='stripe' else 'razorpay_plan_id'
    provider_id=plan.get(id_key)
    if not provider_id: raise HTTPException(404,'Provider plan not found.')
    if provider=='stripe':
        if not os.getenv('STRIPE_SECRET_KEY'): raise HTTPException(503,'Stripe secret key is not configured.')
        try:
            import stripe
            stripe.api_key=os.getenv('STRIPE_SECRET_KEY')
            stripe.Price.modify(provider_id,active=False)
        except Exception as exc: raise HTTPException(502,'Stripe could not deactivate this price.') from exc
    # Razorpay subscription plans cannot be edited or deleted through its API. Remove
    # the app mapping so it is no longer offered; existing subscriptions keep their plan ID.
    plan[id_key]=''
    if not plan.get('stripe_price_id') and not plan.get('razorpay_plan_id'):
        if slug=='free': raise HTTPException(409,'The Free plan cannot be deleted.')
        if not db.query(User).filter_by(plan=slug).first(): plan['active']=False
    _write_plan_catalog(db,plans)
    write_audit(db,admin,'plan.provider_removed','plan',slug,{'provider':provider,'provider_plan_id':provider_id})
    db.commit()
    return {'ok':True,'provider':provider,'slug':slug}

@router.put('/plans')
def save_plans(body: PlanCatalogUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plans = [item.model_dump() for item in body.plans]
    slugs = [item['slug'] for item in plans]
    if len(slugs) != len(set(slugs)): raise HTTPException(422, 'Plan identifiers must be unique.')
    if 'free' not in slugs: raise HTTPException(422, 'The Free plan cannot be removed.')
    existing = {p['slug'] for p in get_plan_catalog(db)}
    removed = existing - set(slugs)
    for slug in removed:
        if db.query(User).filter_by(plan=slug).first(): raise HTTPException(409, f"The '{slug}' plan is assigned to users and cannot be deleted yet.")
    setting = db.get(AppSetting, 'plan_catalog')
    value = json.dumps(plans, separators=(',', ':'))
    if setting: setting.value, setting.updated_at = value, now()
    else: db.add(AppSetting(key='plan_catalog', value=value, updated_at=now()))
    write_audit(db, admin, 'plans.updated', 'plan_catalog', 'plan_catalog', {'plans': slugs})
    db.commit()
    return {'plans': get_plan_catalog(db)}

@router.get('/plan-options')
def admin_plan_options(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return {'plans': [{'slug': p['slug'], 'name': p['name']} for p in get_plan_catalog(db)]}

@router.put('/topups/packages')
def save_topup_packages(body: TopupPackagesUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    packages = body.packages
    if len(packages) > 50: raise HTTPException(422, 'You can configure up to 50 top-up packages.')
    value = json.dumps([{'id': str(i), **item.model_dump()} for i, item in enumerate(packages)], separators=(',', ':'))
    setting = db.get(AppSetting, 'topup_packages')
    if setting: setting.value, setting.updated_at = value, now()
    else: db.add(AppSetting(key='topup_packages', value=value, updated_at=now()))
    write_audit(db, admin, 'topup_packages.updated', 'topup_packages', 'topup_packages', {'count': len(packages)})
    db.commit()
    return {'packages': _topup_catalog(db)}


@router.get("/subscriptions")
def subscriptions(page: int = 1, limit: int = 25, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(User).filter(or_(User.subscription_id.isnot(None), User.razorpay_subscription_id.isnot(None)))
    total = query.count()
    accounts = query.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    items = []
    for account in accounts:
        provider = "razorpay" if account.razorpay_subscription_id else (account.billing_provider or "stripe")
        items.append({"id": account.razorpay_subscription_id or account.subscription_id, "provider": provider,
                      "status": "active" if account.plan != "free" else "pending", "plan": account.plan,
                      "created_at": account.created_at, "user_name": account.name, "user_email": account.email})
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.put("/settings/payment-provider")
def update_payment_settings(body: PaymentProviderUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if body.provider not in ("stripe", "razorpay"):
        raise HTTPException(422, "Choose Stripe or Razorpay.")
    status = payment_provider_status(db)
    if not status[body.provider]["configured"]:
        raise HTTPException(409, f"{body.provider.title()} is not configured. Add its required credentials and plan IDs to the API environment first.")
    previous = get_payment_provider(db)
    setting = db.get(AppSetting, "payment_provider")
    if setting:
        setting.value, setting.updated_at = body.provider, now()
    else:
        db.add(AppSetting(key="payment_provider", value=body.provider))
    if previous != body.provider:
        write_audit(db, admin, "payment_provider.changed", "payment_provider", body.provider, {"from": previous, "to": body.provider})
    db.commit()
    return {"provider": body.provider, "providers": status}


def get_site_branding(db: Session) -> dict:
    setting = db.get(AppSetting, "site_branding")
    try: data = json.loads(setting.value) if setting else {}
    except (TypeError, json.JSONDecodeError): data = {}
    mode = str(data.get("brand_display") or "both")
    if mode not in ("both", "image", "text"):
        mode = "both"
    return {"name": str(data.get("name") or "AgentForge"), "logo": str(data.get("logo") or ""), "brand_display": mode}


@router.get("/settings/site")
def site_settings(request: Request, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    branding = get_site_branding(db)
    version = hashlib.sha256(branding["logo"].encode()).hexdigest()[:12] if branding["logo"] else ""
    logo_url = f"{str(request.base_url).rstrip('/')}/api/v1/admin/settings/site/logo?v={version}" if branding["logo"] else ""
    return {"name":branding["name"],"logo_url":logo_url,"has_logo":bool(branding["logo"]),"brand_display":branding["brand_display"]}


@router.put("/settings/site")
def update_site_settings(body: SiteSettingsUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    current = get_site_branding(db)
    logo = current["logo"] if body.logo is None else body.logo.strip()
    brand_display = body.brand_display or current["brand_display"]
    bucket = os.getenv('S3_BUCKET')
    if logo and (not bucket or not logo.startswith(f's3://{bucket}/site-assets/branding/')):
        raise HTTPException(422,"Choose a logo uploaded to this workspace's S3 bucket.")
    if brand_display == "image" and not logo:
        raise HTTPException(422,"Upload a logo image before setting display mode to Image only.")
    setting = db.get(AppSetting,"site_branding")
    value = json.dumps({"name":body.name,"logo":logo,"brand_display":brand_display},separators=(',',':'))
    if setting: setting.value,setting.updated_at = value,now()
    else: db.add(AppSetting(key="site_branding",value=value))
    write_audit(db,admin,"site_branding.updated","site_settings","site_branding",{"name":body.name,"logo_updated":logo != current["logo"],"brand_display":brand_display})
    db.commit()
    return {"name":body.name,"has_logo":bool(logo),"brand_display":brand_display}


@router.post("/settings/site/logo")
async def upload_site_logo(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not os.getenv('S3_BUCKET'): raise HTTPException(503,"Configure S3_BUCKET before uploading a site logo.")
    raw = await file.read(2 * 1024 * 1024 + 1)
    dims = struct.unpack('>II',raw[16:24]) if len(raw) >= 24 and raw.startswith(b'\x89PNG\r\n\x1a\n') else (0, 0)
    valid_png = 32 <= dims[0] <= 1024 and 32 <= dims[1] <= 512
    if len(raw) > 2 * 1024 * 1024 or not valid_png:
        raise HTTPException(422,"Upload a valid PNG logo (32–1024 px wide, 32–512 px tall, under 2 MB).")
    try: logo = await asyncio.to_thread(store_site_logo,raw)
    except Exception:
        raise HTTPException(502,"Logo upload failed. Check the S3 connection and try again.")
    branding = get_site_branding(db); branding["logo"] = logo
    setting = db.get(AppSetting,"site_branding")
    value = json.dumps(branding,separators=(',',':'))
    if setting: setting.value,setting.updated_at = value,now()
    else: db.add(AppSetting(key="site_branding",value=value))
    write_audit(db,admin,"site_branding.logo_uploaded","site_settings","site_branding",{"bytes":len(raw)})
    db.commit()
    version = hashlib.sha256(logo.encode()).hexdigest()[:12]
    logo_url = f"{str(request.base_url).rstrip('/')}/api/v1/admin/settings/site/logo?v={version}"
    return {"logo_url":logo_url,"has_logo":True}


@router.get("/settings/site/logo")
def admin_site_logo(request: Request, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    logo = get_site_branding(db)["logo"]
    if not logo: raise HTTPException(404,"No site logo has been uploaded.")
    try: content, content_type = read_site_logo(logo)
    except Exception: raise HTTPException(502,"Site logo storage is unavailable.")
    if content_type != "image/png": raise HTTPException(404,"Site logo not found.")
    cache_header = "private, max-age=31536000, immutable" if request.query_params.get("v") else "no-cache, must-revalidate"
    return Response(content,media_type="image/png",headers={"Cache-Control":cache_header,"X-Content-Type-Options":"nosniff"})


@router.get("/users")
def users(q: str = "", page: int = 1, limit: int = 25, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(User)
    if q.strip():
        needle = "%" + q.strip().replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.filter(User.email.ilike(needle) | User.name.ilike(needle))
    total = query.count()
    accounts = query.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    items = []
    for account in accounts:
        items.append({
            "id": account.id, "name": account.name, "email": account.email, "plan": account.plan,
            "is_active": bool(account.is_active), "created_at": account.created_at,
            "agent_count": db.query(func.count(Bot.id)).filter(Bot.user_id == account.id).scalar() or 0,
            "message_count": db.query(func.count(Message.id)).join(Bot, Message.bot_id == Bot.id).filter(Bot.user_id == account.id, Message.role == "user").scalar() or 0,
            "has_subscription": bool(account.subscription_id or account.razorpay_subscription_id),
        })
    return {"items": items, "total": total, "page": page, "limit": limit, "plan_options": [{'slug': p['slug'], 'name': p['name']} for p in get_plan_catalog(db)]}


@router.get("/users/{user_id}")
def user_detail(user_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    admin_id = os.getenv("ADMIN_USER_ID", "").strip()
    bots = db.query(Bot).filter_by(user_id=target.id).order_by(Bot.created_at.desc()).all()
    bot_ids = [b.id for b in bots]
    bot_names = {b.id: b.name for b in bots}
    active_sessions = db.query(func.count(LoginSession.token_hash)).filter(LoginSession.user_id == target.id).scalar() or 0
    api_keys = db.query(ApiKey).filter_by(user_id=target.id).order_by(ApiKey.created_at.desc()).all()
    tickets = db.query(SupportTicket).filter_by(user_id=target.id).order_by(SupportTicket.updated_at.desc()).all()
    ticket_ids = [t.id for t in tickets]

    agent_items = []
    for bot in bots:
        wf = db.query(Workflow).filter_by(bot_id=bot.id).first()
        doc_count = db.query(func.count(Document.id)).filter(Document.bot_id == bot.id).scalar() or 0
        ready_docs = db.query(func.count(Document.id)).filter(Document.bot_id == bot.id, Document.status == "READY").scalar() or 0
        failed_docs = db.query(func.count(Document.id)).filter(Document.bot_id == bot.id, Document.status == "FAILED").scalar() or 0
        chunk_count = db.query(func.count(Chunk.id)).filter(Chunk.bot_id == bot.id).scalar() or 0
        conv_count = db.query(func.count(Conversation.id)).filter(Conversation.bot_id == bot.id).scalar() or 0
        msg_count = db.query(func.count(Message.id)).filter(Message.bot_id == bot.id, Message.role == "user").scalar() or 0
        flag_count = db.query(func.count(Flag.id)).filter(Flag.bot_id == bot.id, Flag.status == "open").scalar() or 0
        agent_items.append({
            "id": bot.id, "name": bot.name, "slug": bot.slug, "public_key": bot.public_key,
            "description": bot.description or "", "system_prompt": bot.system_prompt or "",
            "threshold": bot.threshold, "published": bool(bot.published),
            "widget_config": bot.widget_config or {}, "created_at": bot.created_at,
            "documents": doc_count, "ready_documents": ready_docs, "failed_documents": failed_docs,
            "chunks": chunk_count, "conversations": conv_count, "messages": msg_count, "open_flags": flag_count,
            "has_workflow": bool(wf), "workflow_enabled": bool(wf and wf.enabled), "workflow_version": wf.version if wf else 0,
        })

    attempts = db.query(BillingAttempt).filter_by(user_id=target.id).order_by(BillingAttempt.created_at.desc()).limit(50).all()
    payments = db.query(Payment).filter_by(user_id=target.id).order_by(Payment.created_at.desc()).limit(50).all()
    usage_rows = db.query(TokenUsage).filter_by(user_id=target.id).order_by(TokenUsage.created_at.desc()).limit(50).all()

    conv_items = []
    if bot_ids:
        convs = db.query(Conversation).filter(Conversation.bot_id.in_(bot_ids)).order_by(Conversation.created_at.desc()).limit(50).all()
        for conv in convs:
            last = db.query(Message).filter_by(conversation_id=conv.id).order_by(Message.created_at.desc()).first()
            conv_items.append({
                "id": conv.id, "agent_id": conv.bot_id, "agent_name": bot_names.get(conv.bot_id, "Agent"),
                "visitor_id": conv.visitor_id, "user_id": conv.user_id, "user_name": conv.user_name,
                "created_at": conv.created_at,
                "last_message_at": last.created_at if last else conv.created_at,
                "last_message": last.content[:240] if last else "",
                "message_count": db.query(func.count(Message.id)).filter_by(conversation_id=conv.id).scalar() or 0,
            })

    entity_ids = [target.id, *bot_ids, *ticket_ids]
    audit_rows = (
        db.query(AdminAudit, User)
        .join(User, AdminAudit.actor_id == User.id)
        .filter(AdminAudit.entity_id.in_(entity_ids) | (AdminAudit.actor_id == target.id))
        .order_by(AdminAudit.created_at.desc())
        .limit(100)
        .all()
    )
    bot_logs = (
        db.query(BotActivityLog)
        .filter(BotActivityLog.bot_id.in_(bot_ids))
        .order_by(BotActivityLog.created_at.desc())
        .limit(100)
        .all()
    ) if bot_ids else []

    return {
        "user": {
            "id": target.id, "name": target.name, "email": target.email,
            "plan": target.plan, "is_active": bool(target.is_active),
            "is_admin": bool(admin_id and target.id == admin_id),
            "company": target.company or "", "bio": target.bio or "",
            "avatar_url": target.avatar_url or "", "google_connected": bool(target.google_sub),
            "billing_provider": target.billing_provider,
            "stripe_customer_id": target.stripe_customer_id, "subscription_id": target.subscription_id,
            "razorpay_subscription_id": target.razorpay_subscription_id,
            "has_subscription": bool(target.subscription_id or target.razorpay_subscription_id),
            "free_started_at": target.free_started_at, "free_trial_used": bool(target.free_trial_used),
            "subscription_tokens": target.subscription_tokens, "topup_tokens": target.topup_tokens,
            "created_at": target.created_at,
            "active_session_count": active_sessions,
            "api_key_count": len(api_keys),
            "ticket_count": len(tickets),
            "agent_count": len(bots),
            "published_agent_count": sum(1 for b in bots if b.published),
            "document_count": sum(a["documents"] for a in agent_items),
            "conversation_count": sum(a["conversations"] for a in agent_items),
            "message_count": sum(a["messages"] for a in agent_items),
        },
        "plan_options": [{"slug": p["slug"], "name": p["name"], "tokens": p.get("tokens", 0)} for p in get_plan_catalog(db)],
        "agents": agent_items,
        "subscription": {
            "plan": target.plan, "billing_provider": target.billing_provider,
            "has_subscription": bool(target.subscription_id or target.razorpay_subscription_id),
            "stripe_customer_id": target.stripe_customer_id, "subscription_id": target.subscription_id,
            "razorpay_subscription_id": target.razorpay_subscription_id,
            "free_started_at": target.free_started_at, "free_trial_used": bool(target.free_trial_used),
            "subscription_tokens": target.subscription_tokens, "topup_tokens": target.topup_tokens,
            "attempts": [{"id": a.id, "provider": a.provider, "provider_reference": a.provider_reference, "plan": a.plan, "status": a.status, "paid_count": a.paid_count, "amount": a.amount, "currency": a.currency, "created_at": a.created_at, "updated_at": a.updated_at} for a in attempts],
            "payments": [{"id": p.id, "provider": p.provider, "kind": p.kind, "plan": p.plan, "tokens": p.tokens, "amount": p.amount, "currency": p.currency, "status": p.status, "created_at": p.created_at} for p in payments],
            "token_usage": [{"id": u.id, "tokens": u.tokens, "subscription_tokens": u.subscription_tokens, "topup_tokens": u.topup_tokens, "source": u.source, "created_at": u.created_at} for u in usage_rows],
        },
        "conversations": conv_items,
        "api_keys": [{"id": k.id, "name": k.name, "prefix": k.prefix, "created_at": k.created_at} for k in api_keys],
        "tickets": [support_ticket_item(db, t, target) for t in tickets],
        "logs": {
            "admin_audit": [{"id": e.id, "action": e.action, "entity_type": e.entity_type, "entity_id": e.entity_id, "details": e.details or {}, "created_at": e.created_at, "actor_email": actor.email} for e, actor in audit_rows],
            "bot_activity": [{"id": l.id, "bot_id": l.bot_id, "bot_name": bot_names.get(l.bot_id, "Agent"), "conversation_id": l.conversation_id, "source": l.source, "event_type": l.event_type, "severity": l.severity, "title": l.title, "details": l.details or {}, "created_at": l.created_at} for l in bot_logs],
        },
    }


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    changes = {}
    catalog = get_plan_catalog(db)
    if body.plan is not None:
        if body.plan not in {p['slug'] for p in catalog}:
            raise HTTPException(422, "Choose a valid plan.")
        if target.plan != body.plan:
            changes["plan"] = {"from": target.plan, "to": body.plan}
            target.plan = body.plan
            if body.plan == 'free':
                target.free_started_at = None
                target.free_trial_used = 1
                target.subscription_tokens = next(p['tokens'] for p in catalog if p['slug'] == 'free')
            else:
                target.subscription_tokens = next(p['tokens'] for p in catalog if p['slug'] == body.plan)
    if body.subscription_tokens is not None and target.subscription_tokens != body.subscription_tokens:
        changes["subscription_tokens"] = {"from": target.subscription_tokens, "to": body.subscription_tokens}
        target.subscription_tokens = body.subscription_tokens
    if body.topup_tokens is not None and target.topup_tokens != body.topup_tokens:
        changes["topup_tokens"] = {"from": target.topup_tokens, "to": body.topup_tokens}
        target.topup_tokens = body.topup_tokens
    for field in ("name", "company", "bio", "avatar_url"):
        val = getattr(body, field)
        if val is not None:
            current_val = getattr(target, field) or ""
            next_val = val.strip() if field in ("company", "bio") else val
            if current_val != next_val:
                changes[field] = {"from": current_val, "to": next_val}
                setattr(target, field, next_val)
    if body.is_active is not None:
        desired = int(body.is_active)
        if not desired and target.id == admin.id:
            raise HTTPException(422, "You cannot suspend your own administrator account.")
        if target.is_active != desired:
            changes["status"] = {"from": "active" if target.is_active else "suspended", "to": "active" if desired else "suspended"}
            target.is_active = desired
            if not desired:
                db.query(LoginSession).filter_by(user_id=target.id).delete(synchronize_session=False)
                db.query(ApiKey).filter_by(user_id=target.id).delete(synchronize_session=False)
    if changes:
        write_audit(db, admin, "user.updated", "user", target.id, {"email": target.email, **changes})
        db.commit()
    return {"ok": True, "user": {"id": target.id, "name": target.name, "plan": target.plan, "is_active": bool(target.is_active), "subscription_tokens": target.subscription_tokens, "topup_tokens": target.topup_tokens}}


def _set_agent_published(db: Session, bot: Bot, actor_id: str, published: bool) -> None:
    if published:
        widget = dict(bot.widget_config or {})
        for key, value in {'color': '#d6ff63', 'position': 'right', 'greeting': 'Hi! What can I help you find?', 'logo': '', 'launcher_icon': 'sparkle'}.items():
            widget.setdefault(key, value)
        snapshot = {'name': bot.name, 'description': bot.description or '', 'system_prompt': bot.system_prompt or '', 'threshold': bot.threshold, 'widget_config': widget}
        has_major = db.query(AgentVersion).filter_by(bot_id=bot.id, kind='major').count() > 0
        if not has_major or bot.published_config != snapshot:
            major = db.query(func.max(AgentVersion.major)).filter_by(bot_id=bot.id, kind='major').scalar() or 0
            db.add(AgentVersion(bot_id=bot.id, created_by=actor_id, major=major + 1, minor=0, kind='major', snapshot=snapshot))
            bot.published_config = snapshot
    bot.published = int(published)


@router.patch("/users/{user_id}/agents/{bot_id}")
def update_user_agent(user_id: str, bot_id: str, body: UserAgentUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    bot = db.query(Bot).filter_by(id=bot_id, user_id=user_id).first()
    if not bot:
        raise HTTPException(404, "Agent not found for this user.")
    changes = {}
    if body.name is not None and bot.name != body.name:
        changes["name"] = {"from": bot.name, "to": body.name}
        bot.name = body.name
    if body.description is not None and (bot.description or "") != body.description:
        changes["description"] = {"from": bot.description or "", "to": body.description}
        bot.description = body.description
    if body.system_prompt is not None and (bot.system_prompt or "") != body.system_prompt:
        changes["system_prompt"] = {"changed": True}
        bot.system_prompt = body.system_prompt
    if body.threshold is not None and abs(float(bot.threshold) - float(body.threshold)) > 1e-9:
        changes["threshold"] = {"from": bot.threshold, "to": body.threshold}
        bot.threshold = body.threshold
    if body.published is not None and bool(bot.published) != body.published:
        changes["published"] = {"from": bool(bot.published), "to": body.published}
        _set_agent_published(db, bot, admin.id, body.published)
    if changes:
        write_audit(db, admin, "agent.updated", "agent", bot.id, {"name": bot.name, "owner_email": target.email, **changes})
        db.commit()
    return {"ok": True, "id": bot.id, "published": bool(bot.published)}


@router.delete("/users/{user_id}/keys/{key_id}")
def revoke_user_key(user_id: str, key_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    key = db.query(ApiKey).filter_by(id=key_id, user_id=user_id).first()
    if not key:
        raise HTTPException(404, "API key not found.")
    write_audit(db, admin, "user.api_key_revoked", "user", target.id, {"email": target.email, "key_id": key.id, "name": key.name, "prefix": key.prefix})
    db.delete(key)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/sessions/revoke")
def revoke_user_sessions(user_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    if target.id == admin.id:
        raise HTTPException(422, "You cannot revoke your own active administrator sessions here.")
    count = db.query(LoginSession).filter_by(user_id=target.id).delete(synchronize_session=False)
    write_audit(db, admin, "user.sessions_revoked", "user", target.id, {"email": target.email, "revoked_count": count})
    db.commit()
    return {"ok": True, "revoked_count": count}


@router.get("/agents")
def agents(q: str = "", page: int = 1, limit: int = 25, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(Bot, User).join(User, Bot.user_id == User.id)
    if q.strip():
        needle = "%" + q.strip().replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.filter(Bot.name.ilike(needle) | User.email.ilike(needle))
    total = query.count()
    rows = query.order_by(Bot.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    items = []
    for bot, owner in rows:
        items.append({
            "id": bot.id, "name": bot.name, "owner_id": owner.id, "owner_email": owner.email,
            "published": bool(bot.published), "created_at": bot.created_at,
            "documents": db.query(func.count(Document.id)).filter(Document.bot_id == bot.id).scalar() or 0,
            "messages": db.query(func.count(Message.id)).filter(Message.bot_id == bot.id, Message.role == "user").scalar() or 0,
        })
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.patch("/agents/{bot_id}")
def update_agent(bot_id: str, body: AgentUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    bot = db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(404, "Agent not found.")
    if bool(bot.published) != body.published:
        owner = db.get(User, bot.user_id)
        _set_agent_published(db, bot, admin.id, body.published)
        write_audit(db, admin, "agent.published" if body.published else "agent.unpublished", "agent", bot.id,
                    {"name": bot.name, "owner_email": owner.email if owner else None})
        db.commit()
    return {"ok": True, "id": bot.id, "published": bool(bot.published)}


@router.get("/audit")
def audit(page: int = 1, limit: int = 50, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(AdminAudit, User).join(User, AdminAudit.actor_id == User.id)
    total = query.count()
    rows = query.order_by(AdminAudit.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return {"items": [{
        "id": event.id, "action": event.action, "entity_type": event.entity_type, "entity_id": event.entity_id,
        "details": event.details or {}, "created_at": event.created_at, "actor_email": actor.email,
    } for event, actor in rows], "total": total, "page": page, "limit": limit}


@router.get("/conversations")
def conversations(q: str = "", page: int = 1, limit: int = 25, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(Conversation, Bot, User).join(Bot, Conversation.bot_id == Bot.id).join(User, Bot.user_id == User.id)
    if q.strip():
        needle = "%" + q.strip().replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.filter(Bot.name.ilike(needle) | User.email.ilike(needle))
    total = query.count()
    rows = query.order_by(Conversation.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    items = []
    for conversation, bot, owner in rows:
        last = db.query(Message).filter_by(conversation_id=conversation.id).order_by(Message.created_at.desc()).first()
        items.append({
            "id": conversation.id, "agent_id": bot.id, "agent_name": bot.name, "owner_email": owner.email,
            "created_at": conversation.created_at, "last_message_at": last.created_at if last else conversation.created_at,
            "last_message": last.content[:240] if last else "",
            "message_count": db.query(func.count(Message.id)).filter_by(conversation_id=conversation.id).scalar() or 0,
        })
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    if not db.get(Conversation, conversation_id):
        raise HTTPException(404, "Conversation not found.")
    return [{
        "id": message.id, "role": message.role, "content": message.content,
        "citations": message.citations or [], "created_at": message.created_at,
    } for message in db.query(Message).filter_by(conversation_id=conversation_id).order_by(Message.created_at.asc()).all()]


def support_ticket_item(db: Session, ticket: SupportTicket, owner: User) -> dict:
    last = db.query(SupportTicketMessage).filter_by(ticket_id=ticket.id).order_by(SupportTicketMessage.created_at.desc()).first()
    return {"id": ticket.id, "subject": ticket.subject, "status": ticket.status, "user_id": owner.id,
            "user_name": owner.name, "user_email": owner.email, "created_at": ticket.created_at,
            "updated_at": ticket.updated_at, "admin_unread": bool(ticket.admin_unread),
            "last_message": last.body[:240] if last else "", "last_author_role": last.author_role if last else ""}


@router.get("/support/tickets")
def support_tickets(q: str = "", status: str = "all", page: int = 1, limit: int = 25,
                    db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    page, limit = max(1, page), min(100, max(1, limit))
    query = db.query(SupportTicket, User).join(User, SupportTicket.user_id == User.id)
    if status not in ("all", "open", "waiting_on_user", "in_progress", "resolved", "closed"):
        raise HTTPException(422, "Choose a valid support status.")
    if status != "all":
        query = query.filter(SupportTicket.status == status)
    if q.strip():
        needle = "%" + q.strip().replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.filter(SupportTicket.subject.ilike(needle) | User.name.ilike(needle) | User.email.ilike(needle))
    total = query.count()
    rows = query.order_by(SupportTicket.updated_at.desc()).offset((page - 1) * limit).limit(limit).all()
    unread = db.query(func.count(SupportTicket.id)).filter(SupportTicket.admin_unread == 1).scalar() or 0
    return {"items": [support_ticket_item(db, ticket, owner) for ticket, owner in rows], "total": total,
            "page": page, "limit": limit, "unread": unread}


@router.get("/support/tickets/{ticket_id}")
def support_ticket(ticket_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Support ticket not found.")
    owner = db.get(User, ticket.user_id)
    messages = db.query(SupportTicketMessage).filter_by(ticket_id=ticket.id).order_by(SupportTicketMessage.created_at.asc()).all()
    return {**support_ticket_item(db, ticket, owner), "messages": [{"id": m.id, "author_role": m.author_role,
            "author_name": owner.name if m.author_role == "user" else "Support team", "body": m.body,
            "created_at": m.created_at} for m in messages]}


@router.post("/support/tickets/{ticket_id}/read")
def mark_support_ticket_read(ticket_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Support ticket not found.")
    if ticket.admin_unread:
        ticket.admin_unread = 0
        db.commit()
    return {"ok": True}


@router.post("/support/tickets/{ticket_id}/messages", status_code=201)
def reply_support_ticket(ticket_id: str, body: SupportReply, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Support ticket not found.")
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Reply cannot be blank.")
    db.add(SupportTicketMessage(ticket_id=ticket.id, author_id=admin.id, author_role="admin", body=message))
    ticket.status = "waiting_on_user"
    ticket.user_unread = 1
    ticket.admin_unread = 0
    ticket.updated_at = now()
    write_audit(db, admin, "support_ticket.replied", "support_ticket", ticket.id, {"subject": ticket.subject})
    db.commit()
    return {"ok": True, "status": ticket.status}


@router.patch("/support/tickets/{ticket_id}")
def update_support_ticket(ticket_id: str, body: SupportStatusUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if body.status not in ("open", "in_progress", "waiting_on_user", "resolved", "closed"):
        raise HTTPException(422, "Choose a valid support status.")
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Support ticket not found.")
    previous = ticket.status
    ticket.status = body.status
    ticket.updated_at = now()
    if previous != body.status:
        ticket.user_unread = 1
        write_audit(db, admin, "support_ticket.status_changed", "support_ticket", ticket.id,
                    {"subject": ticket.subject, "from": previous, "to": body.status})
    db.commit()
    return {"ok": True, "status": ticket.status}


@router.get("/site-bot")
def get_site_bot_admin(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    config = ensure_site_bot_seeded(db)
    knowledge = db.query(SiteBotKnowledge).order_by(SiteBotKnowledge.updated_at.desc()).all()
    walkthroughs = db.query(SiteBotWalkthrough).order_by(SiteBotWalkthrough.position.asc(), SiteBotWalkthrough.title.asc()).all()
    total_convs = db.query(func.count(SiteBotConversation.id)).scalar() or 0
    total_msgs = db.query(func.count(SiteBotMessage.id)).scalar() or 0
    logged_in_convs = db.query(func.count(SiteBotConversation.id)).filter(SiteBotConversation.user_id.isnot(None)).scalar() or 0
    total_chunks = db.query(func.count(SiteBotChunk.id)).scalar() or 0
    return {
        "config": serialize_site_bot_config(config),
        "knowledge": [serialize_site_bot_knowledge(item) for item in knowledge],
        "walkthroughs": [serialize_site_bot_walkthrough(g) for g in walkthroughs],
        "stats": {
            "conversations": total_convs,
            "messages": total_msgs,
            "logged_in_conversations": logged_in_convs,
            "knowledge_sources": len(knowledge),
            "knowledge_chunks": total_chunks,
        },
    }


@router.patch("/site-bot/config")
def update_site_bot_config(body: SiteBotConfigPatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    config = ensure_site_bot_seeded(db)
    changes = {}
    for field in ("name", "tagline", "greeting", "system_prompt", "accent_color", "position"):
        val = getattr(body, field)
        if val is not None:
            clean = val.strip() if field in ("tagline", "greeting", "system_prompt") else val
            if getattr(config, field) != clean:
                changes[field] = {"from": getattr(config, field), "to": clean} if field in ("name", "accent_color", "position") else {"changed": True}
                setattr(config, field, clean)
    for bool_field in ("enabled", "include_api_docs"):
        val = getattr(body, bool_field)
        if val is not None and bool(getattr(config, bool_field)) != val:
            changes[bool_field] = {"from": bool(getattr(config, bool_field)), "to": val}
            setattr(config, bool_field, int(val))
    if body.suggested_prompts is not None:
        cleaned_prompts = [p.strip()[:140] for p in body.suggested_prompts if p.strip()]
        if list(config.suggested_prompts or []) != cleaned_prompts:
            changes["suggested_prompts"] = {"count": len(cleaned_prompts)}
            config.suggested_prompts = cleaned_prompts
    if changes:
        config.updated_at = now()
        write_audit(db, admin, "site_bot.config_updated", "site_bot", "default", changes)
        db.commit()
    return {"ok": True, "config": serialize_site_bot_config(config)}


@router.post("/site-bot/knowledge", status_code=201)
async def create_site_bot_knowledge(body: SiteBotKnowledgeInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ensure_site_bot_seeded(db)
    item = SiteBotKnowledge(title=body.title, source_type="text", content=body.content, enabled=int(body.enabled))
    db.add(item)
    db.flush()
    try:
        await index_site_knowledge(db, item)
    except ValueError as error:
        db.rollback()
        raise HTTPException(422, str(error))
    write_audit(db, admin, "site_bot.knowledge_created", "site_bot_knowledge", item.id, {"title": item.title, "source_type": "text", "chunks": item.chunk_count})
    db.commit()
    return serialize_site_bot_knowledge(item)


@router.post("/site-bot/knowledge/upload", status_code=201)
async def upload_site_bot_knowledge(
    file: UploadFile = File(...),
    title: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ensure_site_bot_seeded(db)
    raw = await file.read(MAX_BYTES + 1)
    filename = file.filename or "document.pdf"
    try:
        extracted = parse_file(filename, raw)
    except ValueError as error:
        raise HTTPException(422, str(error))
    if not extracted.strip():
        raise HTTPException(422, "No readable text found in this document. Scanned PDFs require OCR before upload.")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "text"
    source_type = "pdf" if ext == "pdf" else ext if ext in ("docx", "txt", "md") else "text"
    item = SiteBotKnowledge(
        title=(title or filename).strip()[:200],
        source_type=source_type,
        content=extracted.strip(),
        enabled=1,
    )
    db.add(item)
    db.flush()
    try:
        await index_site_knowledge(db, item)
    except ValueError as error:
        db.rollback()
        raise HTTPException(422, str(error))
    write_audit(db, admin, "site_bot.knowledge_uploaded", "site_bot_knowledge", item.id, {"title": item.title, "source_type": source_type, "chunks": item.chunk_count})
    db.commit()
    return serialize_site_bot_knowledge(item)


@router.patch("/site-bot/knowledge/{item_id}")
async def update_site_bot_knowledge(item_id: str, body: SiteBotKnowledgePatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    item = db.get(SiteBotKnowledge, item_id)
    if not item:
        raise HTTPException(404, "Knowledge source not found.")
    changes = {}
    if body.title is not None:
        clean_title = body.title.strip()
        if not clean_title:
            raise HTTPException(422, "Title cannot be blank.")
        if item.title != clean_title:
            changes["title"] = {"from": item.title, "to": clean_title}
            item.title = clean_title
    if body.enabled is not None and bool(item.enabled) != body.enabled:
        changes["enabled"] = {"from": bool(item.enabled), "to": body.enabled}
        item.enabled = int(body.enabled)
    if body.content is not None:
        clean_content = body.content.strip()
        if not clean_content:
            raise HTTPException(422, "Content cannot be blank.")
        if item.content != clean_content:
            changes["content"] = {"changed": True}
            item.content = clean_content
            try:
                await index_site_knowledge(db, item)
            except ValueError as error:
                db.rollback()
                raise HTTPException(422, str(error))
    if changes:
        item.updated_at = now()
        write_audit(db, admin, "site_bot.knowledge_updated", "site_bot_knowledge", item.id, {"title": item.title, **changes})
        db.commit()
    return serialize_site_bot_knowledge(item)


@router.delete("/site-bot/knowledge/{item_id}")
def delete_site_bot_knowledge(item_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    item = db.get(SiteBotKnowledge, item_id)
    if not item:
        raise HTTPException(404, "Knowledge source not found.")
    write_audit(db, admin, "site_bot.knowledge_deleted", "site_bot_knowledge", item.id, {"title": item.title, "source_type": item.source_type})
    db.query(SiteBotChunk).filter_by(knowledge_id=item.id).delete()
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.post("/site-bot/walkthroughs", status_code=201)
def create_site_bot_walkthrough(body: SiteBotWalkthroughInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ensure_site_bot_seeded(db)
    if db.query(SiteBotWalkthrough).filter_by(slug=body.slug).first():
        raise HTTPException(409, "A walkthrough with this slug already exists.")
    guide = SiteBotWalkthrough(
        slug=body.slug,
        title=body.title.strip(),
        description=body.description.strip(),
        keywords=[k.strip() for k in body.keywords if k.strip()],
        steps=[s.model_dump() for s in body.steps],
        enabled=int(body.enabled),
        position=body.position,
    )
    db.add(guide)
    db.flush()
    write_audit(db, admin, "site_bot.walkthrough_created", "site_bot_walkthrough", guide.id, {"slug": guide.slug, "title": guide.title, "steps": len(guide.steps)})
    db.commit()
    return serialize_site_bot_walkthrough(guide)


@router.patch("/site-bot/walkthroughs/{guide_id}")
def update_site_bot_walkthrough(guide_id: str, body: SiteBotWalkthroughPatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    guide = db.get(SiteBotWalkthrough, guide_id)
    if not guide:
        raise HTTPException(404, "Walkthrough guide not found.")
    changes = {}
    if body.slug is not None and body.slug != guide.slug:
        if db.query(SiteBotWalkthrough).filter(SiteBotWalkthrough.slug == body.slug, SiteBotWalkthrough.id != guide_id).first():
            raise HTTPException(409, "Another walkthrough already uses that slug.")
        changes["slug"] = {"from": guide.slug, "to": body.slug}
        guide.slug = body.slug
    if body.title is not None:
        clean_title = body.title.strip()
        if clean_title != guide.title:
            changes["title"] = {"from": guide.title, "to": clean_title}
            guide.title = clean_title
    if body.description is not None and body.description.strip() != guide.description:
        changes["description"] = {"changed": True}
        guide.description = body.description.strip()
    if body.keywords is not None:
        cleaned_kw = [k.strip() for k in body.keywords if k.strip()]
        if list(guide.keywords or []) != cleaned_kw:
            changes["keywords"] = {"count": len(cleaned_kw)}
            guide.keywords = cleaned_kw
    if body.steps is not None:
        dumped_steps = [s.model_dump() for s in body.steps]
        changes["steps"] = {"count": len(dumped_steps)}
        guide.steps = dumped_steps
    if body.enabled is not None and bool(guide.enabled) != body.enabled:
        changes["enabled"] = {"from": bool(guide.enabled), "to": body.enabled}
        guide.enabled = int(body.enabled)
    if body.position is not None and guide.position != body.position:
        changes["position"] = {"from": guide.position, "to": body.position}
        guide.position = body.position
    if changes:
        guide.updated_at = now()
        write_audit(db, admin, "site_bot.walkthrough_updated", "site_bot_walkthrough", guide.id, {"slug": guide.slug, **changes})
        db.commit()
    return serialize_site_bot_walkthrough(guide)


@router.delete("/site-bot/walkthroughs/{guide_id}")
def delete_site_bot_walkthrough(guide_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    guide = db.get(SiteBotWalkthrough, guide_id)
    if not guide:
        raise HTTPException(404, "Walkthrough guide not found.")
    write_audit(db, admin, "site_bot.walkthrough_deleted", "site_bot_walkthrough", guide.id, {"slug": guide.slug, "title": guide.title})
    db.delete(guide)
    db.commit()
    return {"ok": True}


@router.get("/site-bot/conversations")
def list_site_bot_conversations(
    q: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    ensure_site_bot_seeded(db)
    query = db.query(SiteBotConversation)
    if q.strip():
        needle = "%" + q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
        matching_ids = [
            r[0]
            for r in db.query(SiteBotMessage.conversation_id)
            .filter(SiteBotMessage.content.ilike(needle, escape="\\"))
            .distinct()
            .all()
        ]
        query = query.filter(
            or_(
                SiteBotConversation.visitor_id.ilike(needle, escape="\\"),
                SiteBotConversation.user_name.ilike(needle, escape="\\"),
                SiteBotConversation.user_email.ilike(needle, escape="\\"),
                SiteBotConversation.ip_address.ilike(needle, escape="\\"),
                SiteBotConversation.device_summary.ilike(needle, escape="\\"),
                SiteBotConversation.current_page.ilike(needle, escape="\\"),
                SiteBotConversation.id.in_(matching_ids) if matching_ids else False,
            )
        )
    total = query.count()
    items = query.order_by(SiteBotConversation.updated_at.desc()).offset((page - 1) * limit).limit(limit).all()
    rows = []
    for conv in items:
        last = db.query(SiteBotMessage).filter_by(conversation_id=conv.id).order_by(SiteBotMessage.created_at.desc()).first()
        msg_count = db.query(func.count(SiteBotMessage.id)).filter_by(conversation_id=conv.id).scalar() or 0
        rows.append({
            "id": conv.id,
            "visitor_id": conv.visitor_id,
            "user_id": conv.user_id,
            "user_name": conv.user_name,
            "user_email": conv.user_email,
            "ip_address": conv.ip_address,
            "device_summary": conv.device_summary,
            "user_agent": conv.user_agent,
            "current_page": conv.current_page,
            "message_count": msg_count,
            "last_message": last.content[:220] if last else "",
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
        })
    return {"items": rows, "total": total, "page": page, "limit": limit}


@router.get("/site-bot/conversations/{conv_id}")
def get_site_bot_conversation_detail(conv_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    conv = db.get(SiteBotConversation, conv_id)
    if not conv:
        raise HTTPException(404, "Website assistant conversation not found.")
    messages = db.query(SiteBotMessage).filter_by(conversation_id=conv.id).order_by(SiteBotMessage.created_at.asc()).all()
    return {
        "conversation": {
            "id": conv.id,
            "visitor_id": conv.visitor_id,
            "user_id": conv.user_id,
            "user_name": conv.user_name,
            "user_email": conv.user_email,
            "ip_address": conv.ip_address,
            "device_summary": conv.device_summary,
            "user_agent": conv.user_agent,
            "current_page": conv.current_page,
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
        },
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "actions": m.actions or [],
                "citations": m.citations or [],
                "page_path": m.page_path,
                "created_at": m.created_at,
            }
            for m in messages
        ],
    }


class SitePageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    subtitle: str | None = Field(default=None, max_length=500)
    content: str | None = Field(default=None, max_length=150000)
    status: Literal["published", "draft"] | None = None

    @field_validator("title")
    @classmethod
    def check_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        if not clean:
            raise ValueError("Title cannot be blank.")
        return clean


class FaqItemInput(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=10000)
    category: str = Field(default="General", min_length=1, max_length=80)
    position: int = Field(default=0, ge=0, le=9999)
    published: bool = True

    @field_validator("question", "answer", "category")
    @classmethod
    def check_non_blank(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Fields cannot be blank.")
        return clean


class FaqItemPatch(BaseModel):
    question: str | None = Field(default=None, min_length=1, max_length=500)
    answer: str | None = Field(default=None, min_length=1, max_length=10000)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    position: int | None = Field(default=None, ge=0, le=9999)
    published: bool | None = None


@router.get("/pages")
def list_admin_pages(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    pages = ensure_site_pages_seeded(db)
    total_faqs = db.query(func.count(FaqItem.id)).scalar() or 0
    return {
        "items": [
            serialize_site_page(p, faq_count=total_faqs if p.slug == "faqs" else None)
            for p in pages
        ]
    }


@router.get("/pages/{slug}")
def get_admin_page(slug: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    ensure_site_pages_seeded(db)
    page = db.get(SitePage, slug)
    if not page:
        raise HTTPException(404, "Page not found.")
    payload = serialize_site_page(page)
    if slug == "faqs":
        faqs = db.query(FaqItem).order_by(FaqItem.position.asc(), FaqItem.created_at.asc()).all()
        payload["faqs"] = [serialize_faq(f) for f in faqs]
        payload["faq_count"] = len(faqs)
    return payload


@router.patch("/pages/{slug}")
def update_admin_page(slug: str, body: SitePageUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ensure_site_pages_seeded(db)
    page = db.get(SitePage, slug)
    if not page:
        raise HTTPException(404, "Page not found.")
    changes = {}
    if body.title is not None and page.title != body.title:
        changes["title"] = {"from": page.title, "to": body.title}
        page.title = body.title
    if body.subtitle is not None and page.subtitle != body.subtitle.strip():
        changes["subtitle"] = {"changed": True}
        page.subtitle = body.subtitle.strip()
    if body.content is not None and page.content != body.content:
        changes["content"] = {"changed": True}
        page.content = body.content
    if body.status is not None and page.status != body.status:
        changes["status"] = {"from": page.status, "to": body.status}
        page.status = body.status
    if changes:
        page.updated_at = now()
        write_audit(db, admin, "site_page.updated", "site_page", page.slug, changes)
        db.commit()
    return serialize_site_page(page)


@router.post("/pages/faqs/items", status_code=201)
def create_admin_faq(body: FaqItemInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ensure_site_pages_seeded(db)
    faq = FaqItem(
        question=body.question,
        answer=body.answer,
        category=body.category,
        position=body.position,
        published=int(body.published),
    )
    db.add(faq)
    page = db.get(SitePage, "faqs")
    if page:
        page.updated_at = now()
    db.flush()
    write_audit(db, admin, "faq.created", "faq_item", faq.id, {"question": faq.question[:120], "category": faq.category})
    db.commit()
    return serialize_faq(faq)


@router.patch("/pages/faqs/items/{faq_id}")
def update_admin_faq(faq_id: str, body: FaqItemPatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    faq = db.get(FaqItem, faq_id)
    if not faq:
        raise HTTPException(404, "FAQ item not found.")
    changes = {}
    for field in ("question", "answer", "category"):
        val = getattr(body, field)
        if val is not None:
            clean = val.strip()
            if not clean:
                raise HTTPException(422, f"{field.capitalize()} cannot be blank.")
            if getattr(faq, field) != clean:
                changes[field] = {"changed": True}
                setattr(faq, field, clean)
    if body.position is not None and faq.position != body.position:
        changes["position"] = {"from": faq.position, "to": body.position}
        faq.position = body.position
    if body.published is not None and bool(faq.published) != body.published:
        changes["published"] = {"from": bool(faq.published), "to": body.published}
        faq.published = int(body.published)
    if changes:
        faq.updated_at = now()
        page = db.get(SitePage, "faqs")
        if page:
            page.updated_at = now()
        write_audit(db, admin, "faq.updated", "faq_item", faq.id, {"question": faq.question[:120], **changes})
        db.commit()
    return serialize_faq(faq)


@router.delete("/pages/faqs/items/{faq_id}")
def delete_admin_faq(faq_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    faq = db.get(FaqItem, faq_id)
    if not faq:
        raise HTTPException(404, "FAQ item not found.")
    write_audit(db, admin, "faq.deleted", "faq_item", faq.id, {"question": faq.question[:120], "category": faq.category})
    db.delete(faq)
    page = db.get(SitePage, "faqs")
    if page:
        page.updated_at = now()
    db.commit()
    return {"ok": True}
