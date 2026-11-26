"""Shared payment-gateway configuration and persisted selection."""
import os

from sqlalchemy.orm import Session

from .database import AppSetting


def payment_provider_status(db=None) -> dict:
    plans = []
    if db is not None:
        from .plan_catalog import get_plan_catalog
        plans = [p for p in get_plan_catalog(db) if p.get('active', True)]
    paid = [p for p in plans if p.get('slug') != 'free']
    stripe_plans = any(p.get('stripe_price_id') for p in paid) if plans else bool(os.getenv('STRIPE_PRO_PRICE_ID') and os.getenv('STRIPE_TEAM_PRICE_ID'))
    razorpay_plans = any(p.get('razorpay_plan_id') for p in paid) if plans else bool(os.getenv('RAZORPAY_PRO_PLAN_ID') and os.getenv('RAZORPAY_TEAM_PLAN_ID'))
    return {
        "stripe": {
            "configured": bool(os.getenv("STRIPE_SECRET_KEY") and os.getenv("STRIPE_WEBHOOK_SECRET")
                              and stripe_plans),
            "requirements": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "Plans management: Stripe Price ID"],
        },
        "razorpay": {
            "configured": bool(os.getenv("RAZORPAY_KEY_ID") and os.getenv("RAZORPAY_KEY_SECRET")
                              and os.getenv("RAZORPAY_WEBHOOK_SECRET") and razorpay_plans),
            "requirements": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "Plans management: Razorpay Plan ID"],
        },
    }


def get_payment_provider(db: Session) -> str:
    setting = db.get(AppSetting, "payment_provider")
    if setting and setting.value in ("stripe", "razorpay"):
        return setting.value
    configured_default = os.getenv("PAYMENT_PROVIDER", "stripe").strip().lower()
    return configured_default if configured_default in ("stripe", "razorpay") else "stripe"
