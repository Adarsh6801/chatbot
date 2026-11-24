"""Global platform administration endpoints, isolated from workspace APIs."""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import PLANS
from .database import AdminAudit, ApiKey, AppSetting, Bot, Conversation, Document, LoginSession, Message, SupportTicket, SupportTicketMessage, User, get_db, now
from .payment_settings import get_payment_provider, payment_provider_status
from .security import current_user

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


class AgentUpdate(BaseModel):
    published: bool


class PaymentProviderUpdate(BaseModel):
    provider: str


class SupportReply(BaseModel):
    message: str = Field(min_length=1, max_length=10000)


class SupportStatusUpdate(BaseModel):
    status: str


@router.get("/overview")
def overview(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    provider_status = payment_provider_status()
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


@router.get("/settings/payment-provider")
def get_payment_settings(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return {"provider": get_payment_provider(db), "providers": payment_provider_status()}


@router.put("/settings/payment-provider")
def update_payment_settings(body: PaymentProviderUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if body.provider not in ("stripe", "razorpay"):
        raise HTTPException(422, "Choose Stripe or Razorpay.")
    status = payment_provider_status()
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
            "has_subscription": bool(account.subscription_id),
        })
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Account not found.")
    changes = {}
    if body.plan is not None:
        if body.plan not in PLANS:
            raise HTTPException(422, "Choose a valid plan.")
        if target.plan != body.plan:
            changes["plan"] = {"from": target.plan, "to": body.plan}
            target.plan = body.plan
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
    return {"ok": True, "user": {"id": target.id, "plan": target.plan, "is_active": bool(target.is_active)}}


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
        bot.published = int(body.published)
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
