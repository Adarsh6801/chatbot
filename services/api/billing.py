"""Provider-neutral subscription checkout, cancellation, and signed webhooks."""
import hashlib
import hmac
import json
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import PUBLIC_WEB_URL
from .database import User, WebhookEvent, Payment, BillingAttempt, AppSetting, TokenUsage, get_db, now, uid
from .payment_settings import get_payment_provider, payment_provider_status
from .plan_catalog import get_plan, get_plan_catalog, provider_plan_slug, get_plan_limits
from .security import current_user

router = APIRouter(prefix="/api/v1", tags=["billing"])

@router.get('/billing/plans')
def available_plans(db: Session = Depends(get_db)):
    provider = get_payment_provider(db)
    return {'plans': [_public_plan(p, provider) for p in get_plan_catalog(db) if p.get('active', True)]}

def _public_plan(plan, provider=None):
    fields = ('slug','name','active','bots','documents','messages','tokens','stripe_amount','stripe_currency','razorpay_amount','razorpay_currency')
    result = {key: plan.get(key) for key in fields}
    if provider:
        provider_key = 'stripe_price_id' if provider == 'stripe' else 'razorpay_plan_id'
        result['checkout_available'] = plan.get('slug') == 'free' or bool(plan.get(provider_key) or os.getenv(f"{'STRIPE' if provider == 'stripe' else 'RAZORPAY'}_{plan.get('slug','').upper()}_{'PRICE_ID' if provider == 'stripe' else 'PLAN_ID'}"))
    return result

def _topup_packages(db):
    setting = db.get(AppSetting, 'topup_packages')
    try: return json.loads(setting.value) if setting else []
    except (ValueError, TypeError): return []

@router.get('/billing/topups')
def topup_options(db: Session = Depends(get_db), user: User = Depends(current_user)):
    payments = db.query(Payment).filter_by(user_id=user.id, kind='topup').order_by(Payment.created_at.desc()).limit(100).all()
    usage = db.query(TokenUsage).filter_by(user_id=user.id).order_by(TokenUsage.created_at.desc()).limit(100).all()
    subscription = {'provider': user.billing_provider, 'status': 'active' if user.plan != 'free' else 'free', 'current_period_start': None, 'current_period_end': None, 'next_billing_at': None, 'cancel_at': None, 'cancel_at_period_end': False, 'renews': bool(user.plan != 'free'), 'details_available': False}
    try:
        if user.billing_provider == 'stripe' and user.subscription_id and os.getenv('STRIPE_SECRET_KEY'):
            import stripe
            stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
            remote = stripe.Subscription.retrieve(user.subscription_id)
            item_data = ((remote.get('items') or {}).get('data') or [{}])[0]
            period_start = remote.get('current_period_start') or item_data.get('current_period_start')
            period_end = remote.get('current_period_end') or item_data.get('current_period_end')
            status = remote.get('status', 'unknown')
            subscription.update(status=status, current_period_start=period_start, current_period_end=period_end, next_billing_at=period_end,
                                cancel_at=remote.get('cancel_at'), cancel_at_period_end=bool(remote.get('cancel_at_period_end')), renews=status in ('active', 'trialing') and not bool(remote.get('cancel_at_period_end')), details_available=True,
                                interval=((item_data.get('price') or {}).get('recurring') or {}).get('interval'))
        elif user.billing_provider == 'razorpay' and user.razorpay_subscription_id and os.getenv('RAZORPAY_KEY_ID') and os.getenv('RAZORPAY_KEY_SECRET'):
            response = httpx.get(f"https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}", auth=(os.getenv('RAZORPAY_KEY_ID'), os.getenv('RAZORPAY_KEY_SECRET')), timeout=10)
            response.raise_for_status()
            remote = response.json()
            subscription.update(status=remote.get('status', 'unknown'), current_period_start=remote.get('current_start'), current_period_end=remote.get('current_end'), next_billing_at=remote.get('charge_at'), cancel_at=remote.get('end_at'),
                                cancel_at_period_end=remote.get('end_at') is not None, renews=remote.get('status') in ('active', 'authenticated') and remote.get('end_at') is None, details_available=True)
        elif user.plan == 'free' and user.free_started_at:
            from datetime import datetime, timedelta
            started = datetime.fromisoformat(user.free_started_at)
            subscription.update(status='active' if started + timedelta(days=30) > datetime.now(started.tzinfo) else 'expired', current_period_start=int(started.timestamp()), current_period_end=int((started + timedelta(days=30)).timestamp()), renews=False, details_available=True)
    except Exception:
        # Billing history and balances remain available if a provider is briefly
        # unreachable; never display guessed renewal dates.
        pass
    return {'packages': _topup_packages(db), 'transactions': [{'id': p.id, 'payment_link_id':p.id.removeprefix('razorpay:topup-link:') if p.provider=='razorpay' and p.id.startswith('razorpay:topup-link:') else None, 'status': p.status, 'amount': p.amount, 'currency': p.currency, 'tokens': p.tokens, 'provider': p.provider, 'created_at': p.created_at} for p in payments], 'usage': [{'tokens': u.tokens, 'subscription_tokens': u.subscription_tokens, 'topup_tokens': u.topup_tokens, 'source': u.source, 'created_at': u.created_at} for u in usage], 'subscription_tokens': user.subscription_tokens, 'topup_tokens': user.topup_tokens, 'subscription': subscription}

class TopupCheckoutInput(BaseModel):
    package_id: str

@router.post('/billing/topups/checkout')
def topup_checkout(body: TopupCheckoutInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    package = next((p for p in _topup_packages(db) if p.get('id') == body.package_id), None)
    if not package: raise HTTPException(404, 'Top-up package not found.')
    provider = get_payment_provider(db)
    if provider == 'stripe':
        if not os.getenv('STRIPE_SECRET_KEY'): raise HTTPException(503, 'Stripe billing is not configured.')
        import stripe
        stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
        session = stripe.checkout.Session.create(mode='payment', line_items=[{'price_data': {'currency': 'inr', 'product_data': {'name': package['name']}, 'unit_amount': package['amount'] * 100}, 'quantity': 1}], client_reference_id=user.id, metadata={'kind':'topup','user_id':user.id,'tokens':str(package['tokens']),'package_id':package['id']}, success_url=PUBLIC_WEB_URL + '/plans?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}', cancel_url=PUBLIC_WEB_URL + '/plans?billing=cancelled', customer_email=user.email)
        db.add(Payment(id='stripe:topup-session:'+session.id, user_id=user.id, provider='stripe', status='pending', plan='topup', kind='topup', tokens=package['tokens'], amount=package['amount']*100, currency='inr', created_at=now())); db.commit()
        return {'url': session.url}
    key_id, secret = os.getenv('RAZORPAY_KEY_ID'), os.getenv('RAZORPAY_KEY_SECRET')
    if not (key_id and secret): raise HTTPException(503, 'Razorpay billing is not configured.')
    response = httpx.post('https://api.razorpay.com/v1/payment_links', auth=(key_id,secret), json={'amount':package['amount']*100,'currency':'INR','description':package['name'],'customer':{'name':user.name,'email':user.email},'notify':{'email':True},'callback_url':PUBLIC_WEB_URL+'/plans?billing=razorpay_topup_return','callback_method':'get','notes':{'kind':'topup','user_id':user.id,'tokens':str(package['tokens']),'package_id':package['id']}}, timeout=15)
    if response.status_code >= 400: raise HTTPException(502, 'Razorpay could not create the top-up checkout.')
    result=response.json(); db.add(Payment(id='razorpay:topup-link:'+result['id'], user_id=user.id, provider='razorpay', status='pending', plan='topup', kind='topup', tokens=package['tokens'], amount=package['amount']*100, currency='INR', created_at=now())); db.commit()
    return {'url':result['short_url'],'provider':'razorpay','payment_link_id':result['id'],'status':result.get('status','created')}

class TopupStatusInput(BaseModel):
    payment_link_id: str

@router.post('/billing/topups/status')
def topup_status(body: TopupStatusInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    payment_id = 'razorpay:topup-link:' + body.payment_link_id
    payment = db.get(Payment, payment_id)
    if not payment or payment.user_id != user.id or payment.provider != 'razorpay' or payment.kind != 'topup':
        raise HTTPException(404, 'Top-up payment was not found for this account.')
    if payment.status in ('paid','captured'):
        return {'status':'paid','kind':'topup','topup_tokens':user.topup_tokens,'payment_link_id':body.payment_link_id}
    key_id, secret = os.getenv('RAZORPAY_KEY_ID'), os.getenv('RAZORPAY_KEY_SECRET')
    if not (key_id and secret): raise HTTPException(503, 'Razorpay billing is not configured.')
    try:
        response = httpx.get(f'https://api.razorpay.com/v1/payment_links/{body.payment_link_id}', auth=(key_id,secret), timeout=15)
        response.raise_for_status()
        link = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(502, 'Could not verify this Razorpay top-up yet. Please retry shortly.') from exc
    notes = link.get('notes') or {}
    if notes.get('kind') != 'topup' or notes.get('user_id') != user.id:
        raise HTTPException(403, 'This payment link does not belong to your account.')
    state = link.get('status','created')
    if state == 'paid':
        amount_paid = int(link.get('amount_paid') or 0)
        if amount_paid < int(payment.amount or 0) or str(link.get('currency','')).upper() != str(payment.currency or 'INR').upper():
            raise HTTPException(409, 'Razorpay payment amount does not match this top-up. Credits were not applied; contact support.')
        tokens = int(payment.tokens or 0)
        transitioned = db.query(Payment).filter(Payment.id == payment_id, Payment.status.notin_(['paid','captured'])).update({Payment.status:'paid'}, synchronize_session=False)
        if transitioned:
            db.query(User).filter(User.id == user.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
            db.commit()
            db.refresh(user)
        return {'status':'paid','kind':'topup','tokens_added':tokens if transitioned else 0,'topup_tokens':user.topup_tokens,'payment_link_id':body.payment_link_id}
    if state in ('expired','cancelled'):
        payment.status = 'failed' if state == 'expired' else 'cancelled'
        db.commit()
        return {'status':payment.status,'kind':'topup','topup_tokens':user.topup_tokens,'payment_link_id':body.payment_link_id}
    payment.status = 'pending'
    db.commit()
    return {'status':'pending','kind':'topup','provider_status':state,'topup_tokens':user.topup_tokens,'payment_link_id':body.payment_link_id}


class CheckoutInput(BaseModel):
    plan: str


def _stripe_checkout(body: CheckoutInput, db: Session, user: User, plan):
    import stripe

    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    if user.billing_provider == "stripe" and user.subscription_id and user.stripe_customer_id:
        return {"url": stripe.billing_portal.Session.create(customer=user.stripe_customer_id, return_url=PUBLIC_WEB_URL + "/plans").url}
    price = plan.get('stripe_price_id') or os.getenv(f"STRIPE_{body.plan.upper()}_PRICE_ID")
    if not price: raise HTTPException(503, f"Stripe price is not configured for {plan['name']}.")
    attempt_id=uid()
    kwargs = {"customer": user.stripe_customer_id} if user.stripe_customer_id else {"customer_email": user.email}
    session = stripe.checkout.Session.create(
        mode="subscription", line_items=[{"price": price, "quantity": 1}], client_reference_id=user.id,
        metadata={"user_id": user.id, "plan": body.plan, "billing_attempt_id":attempt_id},
        subscription_data={"metadata": {"user_id": user.id, "plan": body.plan}},
        success_url=PUBLIC_WEB_URL + "/plans?billing=success&checkout_session_id={CHECKOUT_SESSION_ID}",
        cancel_url=PUBLIC_WEB_URL + f"/plans?billing=cancelled&attempt_id={attempt_id}", **kwargs,
    )
    db.add(BillingAttempt(id=attempt_id,user_id=user.id,provider='stripe',provider_reference=session.id,plan=body.plan,status='pending',created_at=now(),updated_at=now()))
    db.add(Payment(id='stripe:checkout:'+session.id,user_id=user.id,provider='stripe',status='pending',plan=body.plan,kind='subscription',created_at=now()))
    db.commit()
    return {"url": session.url}


def _razorpay_checkout(body: CheckoutInput, db: Session, user: User, plan):
    key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
    plan_id = plan.get('razorpay_plan_id') or os.getenv(f"RAZORPAY_{body.plan.upper()}_PLAN_ID")
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
    db.add(BillingAttempt(user_id=user.id,provider='razorpay',provider_reference=result['id'],plan=body.plan,status='pending',checkout_url=result['short_url'],created_at=now(),updated_at=now()))
    db.add(Payment(id='razorpay:subscription:'+result['id'],user_id=user.id,provider='razorpay',status='pending',plan=body.plan,kind='subscription',created_at=now()))
    db.commit()
    return {"url": result["short_url"],"provider":"razorpay","status":"created","subscription_id":result['id']}


@router.post("/billing/checkout")
def checkout(body: CheckoutInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    selected_plan = get_plan(db, body.plan)
    if not selected_plan or body.plan == 'free': raise HTTPException(422, 'Choose an active paid plan.')
    if user.razorpay_subscription_id:
        current = billing_status(BillingStatusInput(), db, user)
        if user.razorpay_subscription_id:
            if current.get("status") in ('created','pending'):
                attempt=db.query(BillingAttempt).filter_by(user_id=user.id,provider='razorpay',provider_reference=user.razorpay_subscription_id).order_by(BillingAttempt.created_at.desc()).first()
                if current.get('plan') == body.plan and current.get('url'):
                    if attempt: attempt.status='pending';attempt.updated_at=now();db.commit()
                    payment=db.get(Payment,'razorpay:subscription:'+user.razorpay_subscription_id)
                    if payment: payment.status='pending'
                    db.commit()
                    return {'url':current['url'],'provider':'razorpay','status':'created','subscription_id':user.razorpay_subscription_id,'reused':True}
                if not current.get('url'):
                    raise HTTPException(409,'The pending Razorpay checkout has no retry link. Refresh status or contact support.')
                raise HTTPException(409,'A Razorpay checkout for a different plan is still pending. Finish it or wait for it to expire before choosing another plan.')
            if current.get("status") not in ("active", "authenticated"):
                raise HTTPException(409, f"Razorpay reports this subscription as '{current.get('status', 'unknown')}'. Complete authorization or wait for the provider to update it, then check again.")
            if user.plan == body.plan:
                return {"already_active": True, "plan": user.plan, "provider": "razorpay"}
            key_id, secret = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
            plan_id = selected_plan.get('razorpay_plan_id') or os.getenv(f"RAZORPAY_{body.plan.upper()}_PLAN_ID")
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
                user.subscription_tokens = int(selected_plan['tokens'])
                user.billing_provider = "razorpay"
                db.commit()
                return {"already_active": True, "plan": body.plan, "provider": "razorpay"}
            return {"url": updated.get("short_url"), "provider": "razorpay", "status": updated.get("status", "pending")}
    provider = get_payment_provider(db)
    status = payment_provider_status(db)

    if user.plan != "free":
        if user.billing_provider == "stripe" and user.subscription_id and user.stripe_customer_id:
            if not status["stripe"]["configured"]:
                raise HTTPException(503, "Stripe billing is not configured for this subscription.")
            return _stripe_checkout(body, db, user, selected_plan)
        if user.billing_provider == "razorpay" and user.razorpay_subscription_id:
            raise HTTPException(409, "Manage or cancel your current Razorpay subscription before starting another plan.")
        raise HTTPException(409, "This account already has a paid plan. Contact support to change it.")

    if not status[provider]["configured"]:
        raise HTTPException(503, f"{provider.title()} billing is not configured. Ask the administrator to finish payment setup.")
    return _stripe_checkout(body, db, user, selected_plan) if provider == "stripe" else _razorpay_checkout(body, db, user, selected_plan)


class BillingStatusInput(BaseModel):
    checkout_session_id: str | None = None
    attempt_id: str | None = None
    cancelled: bool = False
    abandoned: bool = False

class SubscriptionCancellationInput(BaseModel):
    cancel_at_period_end: bool


@router.post("/billing/status")
def billing_status(body: BillingStatusInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Refresh checkout status by asking the payment provider directly."""
    checkout_session_id=body.checkout_session_id
    if body.attempt_id:
        stripe_attempt=db.get(BillingAttempt,body.attempt_id)
        if not stripe_attempt or stripe_attempt.user_id != user.id: raise HTTPException(404,'Checkout attempt not found.')
        if stripe_attempt.provider != 'stripe': raise HTTPException(422,'This checkout attempt is not a Stripe session.')
        checkout_session_id=stripe_attempt.provider_reference
    if checkout_session_id:
        if not os.getenv("STRIPE_SECRET_KEY"):
            raise HTTPException(503, "Stripe billing is not configured.")
        import stripe
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
        try:
            session = stripe.checkout.Session.retrieve(checkout_session_id)
            if session.get("client_reference_id") != user.id:
                raise HTTPException(403, "This checkout does not belong to your account.")
            if session.get('payment_status') == 'paid' and (session.get('metadata') or {}).get('kind') == 'topup':
                metadata = session.get('metadata') or {}
                payment_id = 'stripe:topup-session:' + checkout_session_id
                payment = db.get(Payment, payment_id)
                tokens = int(metadata.get('tokens', 0) or 0)
                if payment:
                    transitioned = db.query(Payment).filter(Payment.id == payment_id, Payment.status != 'paid').update({Payment.status:'paid'}, synchronize_session=False)
                    if transitioned: db.query(User).filter(User.id == user.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
                else:
                    db.add(Payment(id=payment_id,user_id=user.id,provider='stripe',status='paid',plan='topup',kind='topup',tokens=tokens,amount=session.get('amount_total'),currency=session.get('currency'),created_at=now()))
                    db.query(User).filter(User.id == user.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
                db.commit(); db.refresh(user)
                return {'status':'paid','kind':'topup','topup_tokens':user.topup_tokens}
            metadata=session.get('metadata') or {}
            attempt_id=metadata.get('billing_attempt_id')
            attempt=db.get(BillingAttempt,attempt_id) if attempt_id else None
            if attempt and attempt.user_id != user.id: raise HTTPException(403,'This checkout does not belong to your account.')
            if session.get("payment_status") != "paid" or not session.get("subscription"):
                if body.cancelled and attempt:
                    if session.get('status') == 'open':
                        try: stripe.checkout.Session.expire(checkout_session_id)
                        except Exception: pass
                    attempt.status='cancelled';attempt.updated_at=now()
                    payment=db.get(Payment,'stripe:checkout:'+checkout_session_id)
                    if payment: payment.status='cancelled'
                    db.commit()
                    return {'status':'cancelled','plan':user.plan,'provider':'stripe'}
                if session.get('status') == 'expired':
                    if attempt: attempt.status='failed';attempt.updated_at=now()
                    payment=db.get(Payment,'stripe:checkout:'+checkout_session_id)
                    if payment: payment.status='failed'
                    db.commit()
                    return {'status':'failed','plan':user.plan,'provider':'stripe'}
                if attempt and attempt.status not in ('cancelled','failed'):
                    attempt.status='pending';attempt.updated_at=now();db.commit()
                return {"status": "pending", "plan": user.plan, "provider":"stripe"}
            subscription = stripe.Subscription.retrieve(session.get("subscription"))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, "Could not verify the Stripe checkout yet.") from exc
        if subscription.get("status") not in ("active", "trialing"):
            return {"status": subscription.get("status", "pending"), "plan": user.plan}
        plan = (session.get("metadata") or {}).get("plan") or (subscription.get("metadata") or {}).get("plan")
        if not get_plan(db, plan) or plan == 'free':
            return {"status": "pending", "plan": user.plan}
        user.stripe_customer_id = session.get("customer")
        user.subscription_id = session.get("subscription")
        user.razorpay_subscription_id = None
        user.billing_provider = "stripe"
        # A status refresh is not a new billing period. Grant the included token
        # allowance only once for this checkout attempt.
        first_success = not attempt or attempt.status != 'succeeded'
        user.plan = plan
        if first_success:
            user.subscription_tokens = int(get_plan_limits(db, plan)['tokens'])
        if attempt: attempt.status='succeeded';attempt.updated_at=now()
        payment_id = "stripe:checkout:" + checkout_session_id
        payment=db.get(Payment,payment_id)
        if not payment:
            db.add(Payment(id=payment_id, user_id=user.id, provider="stripe", status="paid", plan=plan,
                           kind='subscription',amount=session.get("amount_total"), currency=session.get("currency"), created_at=now()))
        else: payment.status='paid';payment.plan=plan
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
        attempt=db.query(BillingAttempt).filter_by(user_id=user.id,provider='razorpay',provider_reference=subscription.get('id') or user.razorpay_subscription_id).order_by(BillingAttempt.created_at.desc()).first()
        if body.abandoned and status == 'created' and attempt:
            attempt.status='abandoned';attempt.updated_at=now();db.commit()
            payment=db.get(Payment,'razorpay:subscription:'+str(subscription.get('id') or user.razorpay_subscription_id))
            if payment: payment.status='abandoned';db.commit()
            return {'status':'abandoned','plan':user.plan,'provider':'razorpay','reusable':True}
        if status in ("active", "authenticated"):
            plan_id = subscription.get("plan_id")
            plan = provider_plan_slug(db, 'razorpay', plan_id)
            notes = subscription.get("notes") or {}
            plan = plan or (notes.get("plan") if get_plan(db, notes.get('plan')) else None)
            if plan:
                provider_paid_count = int(subscription.get('paid_count') or 0)
                # Razorpay status may be polled repeatedly. Refill only for the
                # initial successful authorization/payment or a new paid cycle.
                first_success = bool(attempt and attempt.status != 'succeeded')
                new_paid_cycle = bool(attempt and provider_paid_count > attempt.paid_count)
                legacy_plan_change = not attempt and user.plan != plan
                user.plan = plan
                if first_success or new_paid_cycle or legacy_plan_change:
                    user.subscription_tokens = int(get_plan_limits(db, plan)['tokens'])
                user.billing_provider = "razorpay"
                user.subscription_id = None
                user.stripe_customer_id = None
                if attempt:
                    attempt.status='succeeded'
                    attempt.paid_count=max(attempt.paid_count, provider_paid_count)
                    attempt.updated_at=now()
                payment=db.get(Payment,'razorpay:subscription:'+str(subscription.get('id') or user.razorpay_subscription_id))
                if not payment: db.add(Payment(id='razorpay:subscription:'+str(subscription.get('id') or user.razorpay_subscription_id),user_id=user.id,provider='razorpay',status='paid',plan=plan,kind='subscription',created_at=now()))
                else: payment.status='paid';payment.plan=plan
                db.commit()
            elif reconciled:
                db.rollback()
                raise HTTPException(409, "Razorpay confirmed an active subscription, but its plan could not be matched to this app. Check the configured Razorpay plan IDs.")
        elif status in ("cancelled", "completed", "halted", "expired"):
            if attempt: attempt.status='failed' if status in ('halted','expired') else 'cancelled';attempt.updated_at=now()
            payment=db.get(Payment,'razorpay:subscription:'+str(subscription.get('id') or user.razorpay_subscription_id))
            if payment: payment.status='failed' if status in ('halted','expired') else 'cancelled'
            user.plan = "free"
            user.razorpay_subscription_id = None
            db.commit()
        elif attempt and status == 'created':
            if attempt.status != 'abandoned': attempt.status='pending';attempt.updated_at=now()
            db.commit()
        notes=subscription.get('notes') or {}
        resolved_plan=provider_plan_slug(db,'razorpay',subscription.get('plan_id')) or (notes.get('plan') if get_plan(db,notes.get('plan')) else None)
        return {"status": status, "payment_status": attempt.status if attempt else ('pending' if status=='created' else status), "plan": user.plan if user.plan!='free' else (resolved_plan or 'free'), "provider": "razorpay", "reconciled": reconciled, "url":subscription.get('short_url') or (attempt.checkout_url if attempt else None)}
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

@router.post('/billing/subscription/cancellation')
def set_subscription_cancellation(body: SubscriptionCancellationInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.plan == 'free': raise HTTPException(409, 'There is no paid subscription to change.')
    if user.billing_provider == 'stripe' and user.subscription_id:
        if not os.getenv('STRIPE_SECRET_KEY'): raise HTTPException(503, 'Stripe billing is not configured.')
        try:
            import stripe
            stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
            remote = stripe.Subscription.modify(user.subscription_id, cancel_at_period_end=body.cancel_at_period_end)
            item = ((remote.get('items') or {}).get('data') or [{}])[0]
            period_end = remote.get('current_period_end') or item.get('current_period_end')
            return {'provider':'stripe','status':remote.get('status'),'cancel_at_period_end':bool(remote.get('cancel_at_period_end')),'current_period_end':period_end,'cancel_at':remote.get('cancel_at')}
        except Exception as exc:
            raise HTTPException(502, 'Stripe could not update the subscription renewal setting.') from exc
    if user.billing_provider == 'razorpay' and user.razorpay_subscription_id:
        key_id, secret = os.getenv('RAZORPAY_KEY_ID'), os.getenv('RAZORPAY_KEY_SECRET')
        if not (key_id and secret): raise HTTPException(503, 'Razorpay billing is not configured.')
        try:
            fetched = httpx.get(f'https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}', auth=(key_id,secret), timeout=15)
            fetched.raise_for_status()
            remote = fetched.json()
            if not body.cancel_at_period_end:
                if remote.get('end_at'):
                    raise HTTPException(409, 'Razorpay does not allow a cycle-end cancellation to be reversed once scheduled. Your paid access stays active through the scheduled end date.')
                return {'provider':'razorpay','status':remote.get('status'),'cancel_at_period_end':False,'current_period_end':remote.get('current_end'),'cancel_at':None}
            response = httpx.post(f'https://api.razorpay.com/v1/subscriptions/{user.razorpay_subscription_id}/cancel', auth=(key_id,secret), json={'cancel_at_cycle_end':True}, timeout=15)
            response.raise_for_status()
            remote = response.json()
            return {'provider':'razorpay','status':remote.get('status'),'cancel_at_period_end':True,'current_period_end':remote.get('current_end'),'cancel_at':remote.get('end_at')}
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            raise HTTPException(502, 'Razorpay could not update the subscription renewal setting. Refresh billing status and retry.') from exc
    raise HTTPException(409, 'No active paid subscription is available to change.')


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
            metadata = obj.get('metadata', {})
            if metadata.get('kind') == 'topup':
                tokens = int(metadata.get('tokens', 0) or 0)
                payment_id = 'stripe:topup-session:' + obj.get('id', '')
                payment = db.get(Payment, payment_id)
                if payment:
                    transitioned = db.query(Payment).filter(Payment.id == payment_id, Payment.status != 'paid').update({Payment.status:'paid'}, synchronize_session=False)
                    if transitioned: db.query(User).filter(User.id == target.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
                else:
                    db.add(Payment(id=payment_id, user_id=target.id, provider='stripe', status='paid', plan='topup', kind='topup', tokens=tokens, amount=obj.get('amount_total'), currency=obj.get('currency'), created_at=now()))
                    db.query(User).filter(User.id == target.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
                db.add(WebhookEvent(id=event_id)); db.commit(); return {'ok': True}
            target.stripe_customer_id = obj.get("customer")
            target.subscription_id = obj.get("subscription")
            target.razorpay_subscription_id = None
            target.billing_provider = "stripe"
            plan = obj.get("metadata", {}).get("plan")
            target.plan = plan if get_plan(db, plan) else "free"
            if target.plan != 'free': target.subscription_tokens = int(get_plan_limits(db, target.plan)['tokens'])
    elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
        target = db.query(User).filter_by(subscription_id=obj.get("id"), billing_provider="stripe").first()
        if target:
            items = obj.get("items", {}).get("data", [])
            price = items[0].get("price", {}).get("id") if items else None
            mapped = provider_plan_slug(db, 'stripe', price) if price else None
            plan = mapped or obj.get("metadata", {}).get("plan", "free")
            target.plan = plan if obj.get("status") in ("active", "trialing") and get_plan(db, plan) and kind != "customer.subscription.deleted" else "free"
            if target.plan != 'free': target.subscription_tokens = int(get_plan_limits(db, target.plan)['tokens'])
    elif kind == "invoice.paid":
        customer_id = obj.get("customer")
        target = db.query(User).filter_by(stripe_customer_id=customer_id, billing_provider="stripe").first() if customer_id else None
        if target and obj.get("id"):
            if get_plan(db, target.plan):
                target.subscription_tokens = int(get_plan_limits(db, target.plan)['tokens'])
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
    if kind == 'payment_link.paid':
        link = event.get('payload', {}).get('payment_link', {}).get('entity', {})
        notes = link.get('notes') or {}
        target = db.get(User, notes.get('user_id')) if notes.get('kind') == 'topup' else None
        payment = event.get('payload', {}).get('payment', {}).get('entity', {})
        if target and payment.get('id'):
            payment_id='razorpay:topup-link:'+str(link.get('id') or '')
            existing = db.get(Payment, payment_id) or db.get(Payment, 'razorpay:'+payment['id'])
            if not existing:
                tokens = int(notes.get('tokens', 0) or 0)
                db.query(User).filter(User.id == target.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
                db.add(Payment(id=payment_id,user_id=target.id,provider='razorpay',status=payment.get('status','captured'),plan='topup',kind='topup',tokens=int(notes.get('tokens',0) or 0),amount=payment.get('amount'),currency=payment.get('currency'),created_at=now()))
            else:
                transitioned = db.query(Payment).filter(Payment.id == existing.id, Payment.status.notin_(['paid','captured'])).update({Payment.status:payment.get('status','captured')}, synchronize_session=False)
                if transitioned:
                    tokens = int(notes.get('tokens', 0) or 0)
                    db.query(User).filter(User.id == target.id).update({User.topup_tokens:User.topup_tokens + tokens}, synchronize_session=False)
            db.add(WebhookEvent(id=event_id)); db.commit(); return {'ok':True}
    subscription = event.get("payload", {}).get("subscription", {}).get("entity", {})
    sub_id, plan_id = subscription.get("id"), subscription.get("plan_id")
    target = db.query(User).filter_by(razorpay_subscription_id=sub_id).first() if sub_id else None
    if target:
        tier = provider_plan_slug(db, 'razorpay', plan_id) if plan_id else None
        # Notes are attached when the subscription is created, so existing subscriptions
        # remain mappable even if an operator later rotates a Razorpay plan ID.
        notes = subscription.get("notes") or {}
        tier = tier or (notes.get("plan") if get_plan(db, notes.get('plan')) else None)
        if kind in ("subscription.activated", "subscription.charged", "subscription.resumed") and tier:
            target.plan = tier
            target.subscription_tokens = int(get_plan_limits(db, tier)['tokens'])
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
