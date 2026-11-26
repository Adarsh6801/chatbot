"""Persisted subscription plan definitions shared by checkout and quota checks."""
import json
import os
from .config import PLANS
from .database import AppSetting

def get_plan_catalog(db):
    setting = db.get(AppSetting, 'plan_catalog')
    if setting:
        try:
            rows = json.loads(setting.value)
            if isinstance(rows, list): return rows
        except (ValueError, TypeError):
            pass
    rows = []
    for slug, limits in PLANS.items():
        rows.append({
            'slug': slug, 'name': slug.title(), 'active': True, **limits,
            'stripe_price_id': os.getenv(f'STRIPE_{slug.upper()}_PRICE_ID', ''),
            'stripe_amount': None, 'stripe_currency': 'USD',
            'razorpay_plan_id': os.getenv(f'RAZORPAY_{slug.upper()}_PLAN_ID', ''),
            'razorpay_amount': None, 'razorpay_currency': 'INR',
        })
    return rows

def get_plan(db, slug):
    return next((p for p in get_plan_catalog(db) if p.get('slug') == slug and p.get('active', True)), None)

def get_plan_limits(db, slug):
    plan = next((p for p in get_plan_catalog(db) if p.get('slug') == slug), None)
    if plan:
        return {key: int(plan.get(key, 0) or 0) for key in ('bots', 'documents', 'tokens')}
    return PLANS.get(slug, PLANS['free'])

def provider_plan_slug(db, provider, provider_id):
    key = 'stripe_price_id' if provider == 'stripe' else 'razorpay_plan_id'
    return next((p['slug'] for p in get_plan_catalog(db) if p.get(key) == provider_id and p.get('active', True)), None)
