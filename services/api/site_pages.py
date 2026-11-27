"""Public and seeded endpoints for editable platform pages (FAQs, Terms & Conditions, Privacy Policy)."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .database import AppSetting, FaqItem, SitePage, get_db, now

router = APIRouter(prefix="/api/v1/public/pages", tags=["site-pages"])

DEFAULT_SITE_PAGES = [
    {
        "slug": "faqs",
        "title": "Frequently Asked Questions",
        "subtitle": "Clear answers about building AI support agents, uploading knowledge sources, workflows, pricing, and security.",
        "content": "Browse common questions below or ask Sloty using the assistant in the corner if you need step-by-step help.",
    },
    {
        "slug": "terms",
        "title": "Terms & Conditions",
        "subtitle": "Effective immediately · Governs access to and use of the platform, APIs, and hosted widgets.",
        "content": (
            "## 1. Acceptance of Terms\n"
            "By creating a workspace, accessing the dashboard, integrating our APIs, or embedding a widget, you agree to be bound by these Terms & Conditions.\n\n"
            "## 2. Accounts & Workspace Responsibilities\n"
            "- You are responsible for maintaining the confidentiality of your login credentials and private Account API keys.\n"
            "- You retain full ownership of the documents, knowledge notes, and configurations uploaded to your agents.\n"
            "- Do not upload unlawful content or attempt to bypass rate limits, authentication checks, or network boundaries.\n\n"
            "## 3. Usage, Subscriptions & Token Credits\n"
            "- Plan quotas govern the maximum number of agents, documents, and included monthly subscription tokens.\n"
            "- Purchased top-up tokens remain available alongside active plan balances and are consumed after subscription tokens.\n"
            "- You may cancel or permanently delete your account at any time from your Profile settings.\n\n"
            "## 4. Service Availability & Updates\n"
            "We strive to keep all hosted chat endpoints, knowledge indexing workers, and dashboard controls reliable and secure, and may update platform features to improve performance and safety.\n\n"
            "## 5. Contact\n"
            "For questions regarding these terms, reach out through the Support Center inside your workspace."
        ),
    },
    {
        "slug": "privacy",
        "title": "Privacy Policy",
        "subtitle": "How we collect, process, store, and protect workspace data, uploaded documents, and visitor conversations.",
        "content": (
            "## 1. Information We Collect\n"
            "- **Account Details**: Name, email address, profile preferences, and optional Google sign-in identifier.\n"
            "- **Knowledge Sources**: Documents (PDF, DOCX, TXT, Markdown), URLs, and text notes you attach to your agents.\n"
            "- **Conversation Data**: Visitor messages, generated answers, source citations, and basic request metadata used for security, rate limiting, and diagnostics.\n\n"
            "## 2. How Data Is Used\n"
            "- To index your knowledge base and generate grounded, cited responses for your agents.\n"
            "- To authenticate sessions, track token usage accurately, enforce rate limits, and respond to support requests.\n"
            "- Knowledge sources remain scoped to your workspace and your configured agents.\n\n"
            "## 3. Data Retention & Permanent Deletion\n"
            "- Temporary bot diagnostic logs are automatically pruned after 24 hours.\n"
            "- You can delete individual sources, delete agents, or permanently delete your entire account and associated data at any time from your Account Profile.\n\n"
            "## 4. Security Controls\n"
            "- Passwords and API keys are cryptographically hashed; active login sessions can be revoked anytime.\n"
            "- Private Account API keys should only be used from trusted server-side environments.\n\n"
            "## 5. Contact Us\n"
            "If you have privacy questions or data requests, contact our team via the workspace Support page."
        ),
    },
]

DEFAULT_FAQ_ITEMS = [
    {
        "category": "Getting Started",
        "position": 1,
        "question": "How do I build and publish my first AI agent?",
        "answer": "Open My Agents (/agents), click Create agent, give your assistant a name and short description, upload a PDF/document or URL in the Knowledge tab, test responses in Playground, and click Publish agent in the Deploy tab to get your shareable link and embed script.",
    },
    {
        "category": "Knowledge Base",
        "position": 2,
        "question": "Which file formats and sources are supported?",
        "answer": "You can upload readable PDF, DOCX, TXT, and Markdown files (up to 10 MB each), paste direct knowledge notes, or import public HTTP/HTTPS web pages. Scanned image-only PDFs require OCR before uploading.",
    },
    {
        "category": "Workflows",
        "position": 3,
        "question": "Can my bot collect visitor details or call an external API?",
        "answer": "Yes! Inside any agent's Workflow tab, you can build an optional visual flow combining Message, Intent/Question, Condition, API Request, and Knowledge Search nodes, then publish it cleanly.",
    },
    {
        "category": "API & Integration",
        "position": 4,
        "question": "Where do I find API keys and Chat API documentation?",
        "answer": "Open API Keys (/api-keys) to generate server-side Bearer tokens for workspace endpoints, and visit API Documentation (/api-docs) for complete cURL, JSON, and SSE streaming examples.",
    },
    {
        "category": "Billing & Tokens",
        "position": 5,
        "question": "How do subscription tokens and top-up tokens work?",
        "answer": "Chat requests deduct tokens from your monthly subscription token allowance first. If your subscription tokens run out, requests automatically draw from your top-up token balance.",
    },
    {
        "category": "Privacy & Account",
        "position": 6,
        "question": "Can I permanently delete my account and workspace data?",
        "answer": "Yes. Visit Account Profile (/profile) to view a summary of active subscriptions and bots and permanently delete your account, agents, knowledge sources, API keys, and sessions.",
    },
]

PAGE_ROUTES = {
    "faqs": "/faqs",
    "terms": "/terms",
    "privacy": "/privacy",
}


def serialize_faq(item: FaqItem) -> dict:
    return {
        "id": item.id,
        "question": item.question,
        "answer": item.answer,
        "category": item.category,
        "position": item.position,
        "published": bool(item.published),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def serialize_site_page(page: SitePage, faq_count: int | None = None) -> dict:
    payload = {
        "slug": page.slug,
        "title": page.title,
        "subtitle": page.subtitle,
        "content": page.content,
        "status": page.status,
        "route": PAGE_ROUTES.get(page.slug, f"/{page.slug}"),
        "updated_at": page.updated_at,
    }
    if faq_count is not None:
        payload["faq_count"] = faq_count
    return payload


def ensure_site_pages_seeded(db: Session) -> list[SitePage]:
    """Ensure faqs, terms, and privacy pages plus default FAQ items exist."""
    changed = False
    for entry in DEFAULT_SITE_PAGES:
        existing = db.get(SitePage, entry["slug"])
        if not existing:
            db.add(
                SitePage(
                    slug=entry["slug"],
                    title=entry["title"],
                    subtitle=entry["subtitle"],
                    content=entry["content"],
                    status="published",
                    updated_at=now(),
                )
            )
            changed = True
    if not db.get(AppSetting, "site_pages_seed_v1"):
        if not db.query(FaqItem).count():
            for faq in DEFAULT_FAQ_ITEMS:
                db.add(
                    FaqItem(
                        question=faq["question"],
                        answer=faq["answer"],
                        category=faq["category"],
                        position=faq["position"],
                        published=1,
                    )
                )
        db.add(AppSetting(key="site_pages_seed_v1", value="seeded", updated_at=now()))
        changed = True
    if changed:
        db.commit()
    order = {"faqs": 0, "terms": 1, "privacy": 2}
    pages = db.query(SitePage).all()
    pages.sort(key=lambda p: order.get(p.slug, 99))
    return pages


@router.get("/{slug}")
def get_public_site_page(slug: str, response: Response, db: Session = Depends(get_db)):
    ensure_site_pages_seeded(db)
    page = db.get(SitePage, slug)
    if not page or page.status != "published":
        raise HTTPException(404, "Page not found.")
    response.headers["Cache-Control"] = "no-store"
    payload = serialize_site_page(page)
    if slug == "faqs":
        faqs = (
            db.query(FaqItem)
            .filter_by(published=1)
            .order_by(FaqItem.position.asc(), FaqItem.created_at.asc())
            .all()
        )
        payload["faqs"] = [serialize_faq(f) for f in faqs]
    return payload
