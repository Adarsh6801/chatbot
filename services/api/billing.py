"""Provider-neutral subscription checkout, cancellation, and signed webhooks."""
import hashlib
import hmac
import json
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import PLANS, PUBLIC_WEB_URL
from .database import User, WebhookEvent, Payment, get_db, now
from .payment_settings import get_payment_provider, payment_provider_status
from .security import current_user

router = APIRouter(prefix="/api/v1", tags=["billing"])


class CheckoutInput(BaseModel):
    plan: str


def _stripe_checkout(body: CheckoutInput, user: User):
    import stripe

    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    if user.billing_provider == "stripe" and user.subscription_id and user.stripe_customer_id:
        return {"url": stripe.billing_portal.Session.create(customer=user.stripe_customer_id, return_url=PUBLIC_WEB_URL + "/plans").url}
    price = os.getenv(f"STRIPE_{body.plan.upper()}_PRICE_ID")
    kwargs = {"customer": user.stripe_customer_id} if user.stripe_customer_id else {"customer_email": user.email}
    session = stripe.checkout.Session.create(
        mode="subscription", line_items=[{"price": price, "quantity": 1}], client_reference_id=user.id,
        metadata={"user_id": user.id, "plan": body.plan},
        subscription_data={"metadata": {"user_id": user.id, "plan": body.plan}},
        success_url=PUBLIC_WEB_URL + "/plans?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}", cancel_url=PUBLIC_WEB_URL + "/plans?billing=cancelled", **kwargs,
    )
    return {"url": session.url}


def _razorpay_checkout(body: CheckoutInput, db: Session, user: User):
    key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
    plan_id = os.getenv(f"RAZORPAY_{body.plan.upper()}_PLAN_ID")
    if not (key_id and secret and plan_id):
        raise HTTPException(503, "Razorpay billing is not configured.")
    try:
        response = httpx.post(
            "https://api.razorpay.com/v1/subscriptions",
            auth=(key_id, secret),
            json={"plan_id": plan_id, "total_count": 1200, "quantity": 1, "customer_notify": True,
                  "notes": {"user_id": user.id, "plan": body.plan}},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Razorpay could not be reached. Please try again.") from exc
    if response.status_code >= 400:
        raise HTTPException(502, "Razorpay rejected the subscription setup. Check the configured plan IDs and account mode.")
    result = response.json()
    if not result.get("id") or not result.get("short_url"):
        raise HTTPException(502, "Razorpay returned an incomplete subscription response.")
    user.razorpay_subscription_id = result["id"]
    user.billing_provider = "razorpay"
    db.commit()
    return {"url": result["short_url"]}


@router.post("/billing/checkout")
def checkout(body: CheckoutInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.plan not in ("pro", "team"):
        raise HTTPException(422, "Choose Pro or Team.")
    if user.razorpay_subscription_id:
        current = billing_status(BillingStatusInput(), db, user)
        if user.razorpay_subscription_id:
            if current.get("status") not in ("active", "authenticated"):
                raise HTTPException(409, f"Razorpay reports this subscription as '{current.get('status', 'unknown')}'. Complete authorization or wait for the provider to update it, then check again.")
            if user.plan == body.plan:
                return {"already_active": True, "plan": user.plan, "provider": "razorpay"}
            key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
            plan_id = os.getenv(f"RAZORPAY_{body.plan.upper()}_PLAN_ID")
            if not (key_id and secret and plan_id):
                raise HTTPException(503, "Razorpay billing is not configured for the requested plan.")
            try:
                response = httpx.patch(
                    f"https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}",
                    auth=(key_id, secret), json={"plan_id": plan_id, "schedule_change_at": "now", "customer_notify": True}, timeout=15,
                )
            except httpx.HTTPError as exc:
                raise HTTPException(502, "Razorpay could not update the subscription. Please try again.") from exc
            if response.status_code >= 400:
                raise HTTPException(409, "Razorpay could not change this subscription with its current payment method. The existing subscription is unchanged.")
            updated = response.json()
            if updated.get("status") == "active" and updated.get("plan_id") == plan_id:
                user.plan = body.plan
                user.billing_provider = "razorpay"
                db.commit()
                return {"already_active": True, "plan": body.plan, "provider": "razorpay"}
            return {"url": updated.get("short_url"), "provider": "razorpay", "status": updated.get("status", "pending")}
    provider = get_payment_provider(db)
    status = payment_provider_status()

    if user.plan != "free":
        if user.billing_provider == "stripe" and user.subscription_id and user.stripe_customer_id:
            if not status["stripe"]["configured"]:
                raise HTTPException(503, "Stripe billing is not configured for this subscription.")
            return _stripe_checkout(body, user)
        if user.billing_provider == "razorpay" and user.razorpay_subscription_id:
            raise HTTPException(409, "Manage or cancel your current Razorpay subscription before starting another plan.")
        raise HTTPException(409, "This account already has a paid plan. Contact support to change it.")

    if not status[provider]["configured"]:
        raise HTTPException(503, f"{provider.title()} billing is not configured. Ask the administrator to finish payment setup.")
    return _stripe_checkout(body, user) if provider == "stripe" else _razorpay_checkout(body, db, user)


class BillingStatusInput(BaseModel):
    checkout_session_id: str | None = None


@router.post("/billing/status")
def billing_status(body: BillingStatusInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Refresh checkout status by asking the payment provider directly."""
    if body.checkout_session_id:
        if not os.getenv("STRIPE_SECRET_KEY"):
            raise HTTPException(503, "Stripe billing is not configured.")
        import stripe
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
        try:
            session = stripe.checkout.Session.retrieve(body.checkout_session_id)
            if session.get("client_reference_id") != user.id:
                raise HTTPException(403, "This checkout does not belong to your account.")
            if session.get("payment_status") != "paid" or not session.get("subscription"):
                return {"status": "pending", "plan": user.plan}
            subscription = stripe.Subscription.retrieve(session.get("subscription"))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, "Could not verify the Stripe checkout yet.") from exc
        if subscription.get("status") not in ("active", "trialing"):
            return {"status": subscription.get("status", "pending"), "plan": user.plan}
        plan = (session.get("metadata") or {}).get("plan") or (subscription.get("metadata") or {}).get("plan")
        if plan not in ("pro", "team"):
            return {"status": "pending", "plan": user.plan}
        user.stripe_customer_id = session.get("customer")
        user.subscription_id = session.get("subscription")
        user.razorpay_subscription_id = None
        user.billing_provider = "stripe"
        user.plan = plan
        payment_id = "stripe:checkout:" + body.checkout_session_id
        if not db.get(Payment, payment_id):
            db.add(Payment(id=payment_id, user_id=user.id, provider="stripe", status="paid", plan=plan,
                           amount=session.get("amount_total"), currency=session.get("currency"), created_at=now()))
        db.commit()
        return {"status": "active", "plan": plan, "provider": "stripe"}

    if user.razorpay_subscription_id:
        key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
        if not (key_id and secret):
            raise HTTPException(503, "Razorpay billing is not configured.")
        try:
            response = httpx.get(f"https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}", auth=(key_id, secret), timeout=15)
        except httpx.HTTPError as exc:
            raise HTTPException(502, "Razorpay could not be reached. Please try again.") from exc
        if response.status_code >= 400:
            raise HTTPException(502, "Could not verify the Razorpay subscription yet.")
        subscription = response.json()
        status = subscription.get("status", "pending")
        reconciled = False
        if status not in ("active", "authenticated"):
            # A previous checkout can leave a stale `created` ID on the account even
            # when another checkout for this same user has already become active.
            try:
                collection = httpx.get("https://api.razorpay.com/v1/subscriptions", auth=(key_id, secret), params={"count": 100, "skip": 0}, timeout=15)
            except httpx.HTTPError as exc:
                raise HTTPException(502, "Razorpay could not reconcile this subscription. Please try again.") from exc
            if collection.status_code >= 400:
                raise HTTPException(502, "Razorpay could not reconcile this subscription. Please try again.")
            subscriptions = collection.json().get("items", [])
            candidates = [item for item in subscriptions if (item.get("notes") or {}).get("user_id") == user.id and item.get("status") in ("active", "authenticated")]
            if candidates:
                subscription = max(candidates, key=lambda item: (item.get("status") == "active", int(item.get("created_at") or 0)))
                status = subscription.get("status", "pending")
                user.razorpay_subscription_id = subscription.get("id")
                reconciled = True
        if status in ("active", "authenticated"):
            plan_id = subscription.get("plan_id")
            plan = next((tier for tier in ("pro", "team") if plan_id == os.getenv(f"RAZORPAY_{tier.upper()}_PLAN_ID")), None)
            notes = subscription.get("notes") or {}
            plan = plan or (notes.get("plan") if notes.get("plan") in ("pro", "team") else None)
            if plan:
                user.plan = plan
                user.billing_provider = "razorpay"
                user.subscription_id = None
                user.stripe_customer_id = None
                db.commit()
            elif reconciled:
                db.rollback()
                raise HTTPException(409, "Razorpay confirmed an active subscription, but its plan could not be matched to this app. Check the configured Razorpay plan IDs.")
        elif status in ("cancelled", "completed", "halted", "expired"):
            user.plan = "free"
            user.razorpay_subscription_id = None
            db.commit()
        return {"status": status, "plan": user.plan, "provider": "razorpay", "reconciled": reconciled}
    return {"status": "active" if user.plan != "free" else "pending", "plan": user.plan, "provider": user.billing_provider}


@router.post("/billing/portal")
def portal(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.billing_provider == "razorpay":
        key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
        if not (key_id and secret and user.razorpay_subscription_id):
            raise HTTPException(503, "No active Razorpay subscription is available to manage.")
        try:
            response = httpx.post(
                f"https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}/cancel",
                auth=(key_id, secret), json={"cancel_at_cycle_end": True}, timeout=15,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(502, "Razorpay could not be reached. Please try again.") from exc
        if response.status_code >= 400:
            raise HTTPException(502, "Razorpay could not schedule subscription cancellation.")
        return {"ok": True, "message": "Cancellation is scheduled for the end of your current billing cycle."}

    if not os.getenv("STRIPE_SECRET_KEY") or not user.stripe_customer_id:
        raise HTTPException(503, "No active Stripe billing account is available.")
    import stripe

    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    return {"url": stripe.billing_portal.Session.create(customer=user.stripe_customer_id, return_url=PUBLIC_WEB_URL + "/plans").url}


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Stripe webhooks are not configured.")
    import stripe

    try:
        event = stripe.Webhook.construct_event(await request.body(), request.headers.get("stripe-signature", ""), secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(400, "Invalid webhook signature.") from exc
    event_id = event["id"]
    if db.get(WebhookEvent, event_id):
        return {"ok": True}
    obj = event["data"]["object"].to_dict()
    kind = event["type"]
    if kind == "checkout.session.completed" and obj.get("payment_status") == "paid":
        target = db.get(User, obj.get("client_reference_id"))
        if target:
            target.stripe_customer_id = obj.get("customer")
            target.subscription_id = obj.get("subscription")
            target.razorpay_subscription_id = None
            target.billing_provider = "stripe"
            plan = obj.get("metadata", {}).get("plan")
            target.plan = plan if plan in PLANS else "free"
    elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
        target = db.query(User).filter_by(subscription_id=obj.get("id"), billing_provider="stripe").first()
        if target:
            items = obj.get("items", {}).get("data", [])
            price = items[0].get("price", {}).get("id") if items else None
            mapped = next((tier for tier in ("pro", "team") if price and price == os.getenv(f"STRIPE_{tier.upper()}_PRICE_ID")), None)
            plan = mapped or obj.get("metadata", {}).get("plan", "free")
            target.plan = plan if obj.get("status") in ("active", "trialing") and plan in PLANS and kind != "customer.subscription.deleted" else "free"
    elif kind == "invoice.paid":
        customer_id = obj.get("customer")
        target = db.query(User).filter_by(stripe_customer_id=customer_id, billing_provider="stripe").first() if customer_id else None
        if target and obj.get("id"):
            db.add(Payment(id="stripe:" + obj["id"], user_id=target.id, provider="stripe", status="paid", plan=target.plan,
                           amount=obj.get("amount_paid"), currency=obj.get("currency"), created_at=now()))
    db.add(WebhookEvent(id=event_id))
    db.commit()
    return {"ok": True}


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Razorpay webhooks are not configured.")
    raw = await request.body()
    received = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not received or not hmac.compare_digest(expected, received.lower()):
        raise HTTPException(400, "Invalid webhook signature.")
    event_key = request.headers.get("x-razorpay-event-id", "").strip()
    if not event_key:
        raise HTTPException(400, "Missing Razorpay event ID.")
    event_id = "razorpay:" + event_key
    if db.get(WebhookEvent, event_id):
        return {"ok": True}
    try:
        event = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "Invalid webhook payload.") from exc
    kind = event.get("event", "")
    subscription = event.get("payload", {}).get("subscription", {}).get("entity", {})
    sub_id, plan_id = subscription.get("id"), subscription.get("plan_id")
    target = db.query(User).filter_by(razorpay_subscription_id=sub_id).first() if sub_id else None
    if target:
        tier = next((name for name in ("pro", "team") if plan_id and plan_id == os.getenv(f"RAZORPAY_{name.upper()}_PLAN_ID")), None)
        # Notes are attached when the subscription is created, so existing subscriptions
        # remain mappable even if an operator later rotates a Razorpay plan ID.
        notes = subscription.get("notes") or {}
        tier = tier or (notes.get("plan") if notes.get("plan") in ("pro", "team") else None)
        if kind in ("subscription.activated", "subscription.charged", "subscription.resumed") and tier:
            target.plan = tier
            target.billing_provider = "razorpay"
            target.subscription_id = None
            target.stripe_customer_id = None
        elif kind in ("subscription.cancelled", "subscription.completed", "subscription.halted", "subscription.paused"):
            target.plan = "free"
        if kind == "subscription.charged":
            payment = event.get("payload", {}).get("payment", {}).get("entity", {})
            if payment.get("id"):
                db.add(Payment(id="razorpay:" + payment["id"], user_id=target.id, provider="razorpay", status=payment.get("status", "captured"), plan=target.plan,
                               amount=payment.get("amount"), currency=payment.get("currency"), created_at=now()))
    db.add(WebhookEvent(id=event_id))
    db.commit()
    return {"ok": True}
