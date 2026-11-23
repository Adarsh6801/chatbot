"""Shared payment-gateway configuration and persisted selection."""
import os

from sqlalchemy.orm import Session

from .database import AppSetting


def payment_provider_status() -> dict:
    return {
        "stripe": {
            "configured": bool(os.getenv("STRIPE_SECRET_KEY") and os.getenv("STRIPE_WEBHOOK_SECRET")
                              and os.getenv("STRIPE_PRO_PRICE_ID") and os.getenv("STRIPE_TEAM_PRICE_ID")),
            "requirements": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_PRICE_ID", "STRIPE_TEAM_PRICE_ID"],
        },
        "razorpay": {
            "configured": bool(os.getenv("RAZORPAY_KEY_ID") and os.getenv("RAZORPAY_KEY_SECRET")
                              and os.getenv("RAZORPAY_WEBHOOK_SECRET") and os.getenv("RAZORPAY_PRO_PLAN_ID")
                              and os.getenv("RAZORPAY_TEAM_PLAN_ID")),
            "requirements": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PRO_PLAN_ID", "RAZORPAY_TEAM_PLAN_ID"],
        },
    }


def get_payment_provider(db: Session) -> str:
    setting = db.get(AppSetting, "payment_provider")
    if setting and setting.value in ("stripe", "razorpay"):
        return setting.value
    configured_default = os.getenv("PAYMENT_PROVIDER", "stripe").strip().lower()
    return configured_default if configured_default in ("stripe", "razorpay") else "stripe"
