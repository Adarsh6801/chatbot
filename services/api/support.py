"""User support ticket inbox with private, email-style message threads."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import SupportTicket, SupportTicketMessage, User, get_db, now
from .security import current_user

router = APIRouter(prefix="/api/v1/support", tags=["support"])


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=1, max_length=10000)


class ReplyCreate(BaseModel):
    message: str = Field(min_length=1, max_length=10000)


def user_ticket(db: Session, ticket_id: str, user: User) -> SupportTicket:
    ticket = db.query(SupportTicket).filter_by(id=ticket_id, user_id=user.id).first()
    if not ticket:
        raise HTTPException(404, "Support ticket not found.")
    return ticket


def ticket_item(db: Session, ticket: SupportTicket) -> dict:
    last = db.query(SupportTicketMessage).filter_by(ticket_id=ticket.id).order_by(SupportTicketMessage.created_at.desc()).first()
    return {
        "id": ticket.id, "subject": ticket.subject, "status": ticket.status,
        "created_at": ticket.created_at, "updated_at": ticket.updated_at,
        "unread": bool(ticket.user_unread),
        "last_message": last.body[:240] if last else "",
        "last_author_role": last.author_role if last else "",
    }


@router.get("/tickets")
def list_tickets(db: Session = Depends(get_db), user: User = Depends(current_user)):
    tickets = db.query(SupportTicket).filter_by(user_id=user.id).order_by(SupportTicket.updated_at.desc()).all()
    return {"items": [ticket_item(db, ticket) for ticket in tickets], "total": len(tickets), "unread": sum(bool(ticket.user_unread) for ticket in tickets)}


@router.post("/tickets", status_code=201)
def create_ticket(body: TicketCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Message cannot be blank.")
    ticket = SupportTicket(user_id=user.id, subject=body.subject.strip(), status="open", admin_unread=1, user_unread=0)
    if len(ticket.subject) < 3:
        raise HTTPException(422, "Subject must contain at least 3 characters.")
    db.add(ticket)
    db.flush()
    db.add(SupportTicketMessage(ticket_id=ticket.id, author_id=user.id, author_role="user", body=message))
    ticket.updated_at = now()
    db.commit()
    return ticket_item(db, ticket)


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ticket = user_ticket(db, ticket_id, user)
    messages = db.query(SupportTicketMessage).filter_by(ticket_id=ticket.id).order_by(SupportTicketMessage.created_at.asc()).all()
    return {**ticket_item(db, ticket), "messages": [{"id": m.id, "author_role": m.author_role, "author_name": "Support team" if m.author_role == "admin" else user.name, "body": m.body, "created_at": m.created_at} for m in messages]}


@router.post("/tickets/{ticket_id}/read")
def mark_ticket_read(ticket_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ticket = user_ticket(db, ticket_id, user)
    if ticket.user_unread:
        ticket.user_unread = 0
        db.commit()
    return {"ok": True}


@router.post("/tickets/{ticket_id}/messages", status_code=201)
def reply_ticket(ticket_id: str, body: ReplyCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ticket = user_ticket(db, ticket_id, user)
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Reply cannot be blank.")
    db.add(SupportTicketMessage(ticket_id=ticket.id, author_id=user.id, author_role="user", body=message))
    ticket.status = "open" if ticket.status in ("resolved", "closed") else "open"
    ticket.admin_unread = 1
    ticket.user_unread = 0
    ticket.updated_at = now()
    db.commit()
    return {"ok": True, "status": ticket.status}
