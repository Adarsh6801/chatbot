"""Default knowledge base, API documentation index, and guided walkthrough seeds for Sloty."""
from .database import (
    AppSetting,
    SiteBotChunk,
    SiteBotConfig,
    SiteBotKnowledge,
    SiteBotWalkthrough,
    now,
)
from .rag import chunk_text, embed

DEFAULT_SUGGESTED_PROMPTS = [
    "Guide me step-by-step to build my first bot",
    "What can this platform do?",
    "How do I upload PDFs to a bot?",
    "Show me the Chat API & API keys docs",
    "Take me to my Agents workspace",
]

DEFAULT_KNOWLEDGE_ARTICLES = [
    {
        "title": "What This Platform Is & Core Capabilities",
        "content": (
            "AgentForge is a complete end-to-end platform for building, training, testing, and deploying AI support "
            "and knowledge assistants grounded in your own documents and websites.\n\n"
            "Key capabilities:\n"
            "1. Grounded Knowledge Bases: Upload readable PDFs, DOCX, TXT, and Markdown files (up to 10 MB per file), "
            "paste custom knowledge notes, or import public web pages. Every answer can include verifiable source citations.\n"
            "2. Visual Conversation Workflows: Design optional node-based conversation flows (Start, Message, "
            "Question/Intent, Condition, API Request, Knowledge Search, and End) to collect visitor details, call external "
            "REST APIs, or branch logic before falling back to knowledge retrieval.\n"
            "3. Playground & Improve Flags: Test agents live in the Playground before publishing. Whenever an agent "
            "cannot answer confidently based on its abstention threshold, the question is flagged in the Improve tab so you "
            "can write a verified answer and retrain immediately.\n"
            "4. Hosted Page & Embeddable Widget: Customize colors, chat templates, launcher icons, and greetings, then "
            "publish a live hosted link (/chat/<slug>) or paste the one-line <script> embed snippet on any website.\n"
            "5. Workspace Analytics, Logs & API Access: Inspect visitor conversations, latency, token usage, retrieval "
            "evaluations, 24-hour bot activity logs, and manage owner-scoped API keys."
        ),
    },
    {
        "title": "How to Build & Launch an Agent Step-by-Step",
        "content": (
            "Building and publishing an agent takes five straightforward steps:\n"
            "Step 1 — Open Workspace (/agents) and click 'Create agent': Enter an agent name (1-80 characters) and short description.\n"
            "Step 2 — Add Knowledge Sources (Knowledge tab): Upload PDFs, DOCX, TXT, or Markdown files, import a public "
            "URL, or write direct knowledge notes. Wait for status to turn Ready.\n"
            "Step 3 — Optional Visual Workflow & Settings (Workflow / Settings tabs): Set the agent's tone via "
            "system prompt, adjust the abstention confidence threshold (0.05 to 0.95), or build a visual workflow.\n"
            "Step 4 — Test in Playground: Chat with your draft agent, inspect citations and traces, and verify answers.\n"
            "Step 5 — Customize & Publish (Deploy tab): Choose your chat template and widget styling, then click "
            "'Publish agent' to go live with a shareable hosted link and website embed snippet."
        ),
    },
    {
        "title": "Plans, Token Credits, Billing & Account Management",
        "content": (
            "Plans determine your workspace limits for agents, knowledge sources, and monthly token credits:\n"
            "- Free Plan: Includes starter agent and knowledge limits plus monthly subscription tokens (valid for 30 days on trial accounts).\n"
            "- Paid Plans (Pro / Team): Unlock higher agent limits, larger document quotas, agent version history, and millions of monthly tokens.\n"
            "- Token Top-ups: Extra top-up token packs never expire with monthly resets—chat deductions draw from subscription tokens first, then top-up tokens.\n"
            "- You can manage plans and billing at /plans, update your profile or permanently delete your account at /profile, "
            "and open support tickets directly at /support."
        ),
    },
    {
        "title": "Navigating the Website & Workspace Pages",
        "content": (
            "Quick map of website routes:\n"
            "- Home (/): Platform overview and quick entry into your workspace.\n"
            "- Workspace / My Agents (/agents): View all your agents, create new ones, and inspect each agent's tabs (Workflow, Knowledge, Playground, Improve, Analytics, Conversations, Settings, Deploy, Logs).\n"
            "- Analytics (/analytics): Jump straight to agent performance metrics and evaluations.\n"
            "- Conversations (/conversations): Review visitor conversation history across your agents.\n"
            "- API Keys (/api-keys): Create, copy, and revoke Bearer API keys for server-side integrations.\n"
            "- API Documentation (/api-docs): Complete REST & SSE Chat API reference with cURL and JSON examples.\n"
            "- Customer Documentation (/docs): Step-by-step guides and tutorials.\n"
            "- Plans & Billing (/plans): Compare plans, subscribe, or purchase token top-ups.\n"
            "- Profile & Account (/profile): Edit profile details, link Google OAuth, or delete your account.\n"
            "- Support (/support): Contact customer support and track ticket replies."
        ),
    },
]

DEFAULT_WALKTHROUGHS = [
    {
        "slug": "build-your-first-agent",
        "title": "Build & launch your first AI agent",
        "description": "Walk through creating an agent, uploading knowledge, testing it, and publishing live.",
        "keywords": [
            "build bot",
            "build agent",
            "create bot",
            "create agent",
            "make chatbot",
            "new agent",
            "new bot",
            "walkthrough",
            "guide me",
            "getting started",
            "start building",
        ],
        "position": 1,
        "steps": [
            {
                "title": "Step 1 · Open your Agents workspace",
                "instruction": "Let's head to My Agents and click the glowing 'Create agent' button! Give your bot a friendly name (for example 'Support Helper') and a quick description.",
                "route": "/agents",
                "selector": "[data-tour='create-agent-btn']",
                "action_label": "Click Create agent",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 2 · Add knowledge sources",
                "instruction": "Once inside your agent, make sure you are on the Knowledge tab so your bot learns from PDFs, DOCX, TXT, Markdown files, or public web URLs.",
                "route": "/agents",
                "selector": "[data-tour='tab-knowledge'], [data-tour='agent-card']",
                "action_label": "Open Knowledge tab or select an agent",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 3 · Upload a document or note",
                "instruction": "Right here you can upload a PDF/DOCX/TXT file, paste a website URL, or write direct notes. Wait a few seconds until the status shows Ready!",
                "route": "/agents",
                "selector": "[data-tour='knowledge-add-box']",
                "action_label": "Upload or add knowledge",
                "auto_advance_on_click": False,
            },
            {
                "title": "Step 4 · Test in the Playground",
                "instruction": "Now switch to Playground to chat with your bot and check its citations and confidence scores before going live.",
                "route": "/agents",
                "selector": "[data-tour='tab-playground'], [data-tour='agent-tabs']",
                "action_label": "Open Playground",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 5 · Publish & embed on your site",
                "instruction": "Open the Deploy tab whenever you're ready! Hit 'Publish agent' to activate your shareable chat link and website embed script.",
                "route": "/agents",
                "selector": "[data-tour='publish-agent-btn'], [data-tour='tab-deploy']",
                "action_label": "Open Deploy & Publish",
                "auto_advance_on_click": False,
            },
        ],
    },
    {
        "slug": "add-knowledge-and-pdfs",
        "title": "Upload PDFs & train your agent's knowledge base",
        "description": "Learn how to open an agent, attach readable PDFs or URLs, and verify readiness.",
        "keywords": [
            "upload pdf",
            "add pdf",
            "add document",
            "add knowledge",
            "train bot",
            "train agent",
            "knowledge source",
        ],
        "position": 2,
        "steps": [
            {
                "title": "Step 1 · Pick or create an agent",
                "instruction": "Click any existing agent card (or click Create agent if you don't have one yet) to open its workspace.",
                "route": "/agents",
                "selector": "[data-tour='agent-card'], [data-tour='create-agent-btn']",
                "action_label": "Select an agent",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 2 · Go to the Knowledge tab",
                "instruction": "Make sure the Knowledge tab is selected so you can manage uploaded PDFs, web pages, and custom notes.",
                "route": "/agents",
                "selector": "[data-tour='tab-knowledge']",
                "action_label": "Click Knowledge tab",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 3 · Choose Upload, Website, or Text",
                "instruction": "Use the Add knowledge panel right here to drop in PDFs (up to 10 MB), paste a URL, or add notes. Every chunk is automatically indexed!",
                "route": "/agents",
                "selector": "[data-tour='knowledge-add-box']",
                "action_label": "Add a knowledge source",
                "auto_advance_on_click": False,
            },
        ],
    },
    {
        "slug": "design-visual-workflow",
        "title": "Design a visual conversation workflow",
        "description": "Connect steps, conditions, and external API calls using the Workflow Studio.",
        "keywords": ["workflow", "flow", "visual builder", "api node", "intent", "condition"],
        "position": 3,
        "steps": [
            {
                "title": "Step 1 · Open your agent",
                "instruction": "Select an agent from your workspace to edit its conversation workflow.",
                "route": "/agents",
                "selector": "[data-tour='agent-card'], [data-tour='create-agent-btn']",
                "action_label": "Select an agent",
                "auto_advance_on_click": True,
            },
            {
                "title": "Step 2 · Open the Workflow tab",
                "instruction": "Click the Workflow tab to launch the visual drag-and-connect node editor where you can combine Knowledge Search, Conditions, and API calls.",
                "route": "/agents",
                "selector": "[data-tour='tab-workflow']",
                "action_label": "Click Workflow tab",
                "auto_advance_on_click": True,
            },
        ],
    },
    {
        "slug": "create-api-key-and-integrate",
        "title": "Create an API key & inspect the API docs",
        "description": "Generate an owner-scoped Bearer key and connect your backend or frontend app.",
        "keywords": [
            "api key",
            "api keys",
            "api documentation",
            "api docs",
            "integrate",
            "curl",
            "endpoint",
            "developer",
            "bearer",
        ],
        "position": 4,
        "steps": [
            {
                "title": "Step 1 · Open API Keys",
                "instruction": "Here is your API Keys manager! Enter a recognizable label (like 'Production App') and click 'Create key'. Remember to copy your secret right away.",
                "route": "/api-keys",
                "selector": "[data-tour='create-api-key-btn']",
                "action_label": "Create an API key",
                "auto_advance_on_click": False,
            },
            {
                "title": "Step 2 · Explore the Live API Reference",
                "instruction": "Now you're on the User API Reference! Browse the Chat SSE streaming endpoint, Workspace APIs, and Knowledge upload examples.",
                "route": "/api-docs",
                "selector": "[data-tour='api-docs-nav']",
                "action_label": "Browse API Reference sections",
                "auto_advance_on_click": False,
            },
        ],
    },
]

API_REFERENCE_SECTIONS = [
    {
        "title": "API Reference · Base URL & Authentication",
        "url": "/api-docs#authentication",
        "content": (
            "User API Reference — Base URL & Authentication (/api-docs):\n"
            "All routes use the /api/v1 prefix.\n"
            "- Agent Public Key: Used in public visitor chat URLs (/api/v1/chat/{agent_public_key} and /api/v1/public/chat/{agent_public_key}/history). No account API key required.\n"
            "- Account API Key: Create keys in Workspace -> API keys (/api-keys). Send as 'Authorization: Bearer YOUR_ACCOUNT_API_KEY' from trusted server-side code only; never expose an account API key in browser JavaScript."
        ),
    },
    {
        "title": "API Reference · Chat & History Endpoints (SSE)",
        "url": "/api-docs#chat",
        "content": (
            "POST /api/v1/chat/{agent_public_key} (Auth: Agent public key in URL):\n"
            "Send one message per request and receive a Server-Sent Events (SSE) stream (Content-Type: text/event-stream).\n"
            "Body fields: message (string, required, 1-4000 chars), visitor_id (string, required, 8-100 chars), conversation_id (optional, from previous meta event), user_id (optional), user_name (optional).\n"
            "SSE Events: 'meta' (conversation_id, confidence, citations), 'token' (streamed text fragment), 'done' (tokens, model, abstained), 'error' (safe error message).\n\n"
            "GET /api/v1/public/chat/{agent_public_key}/history?visitor_id={visitor_id}:\n"
            "Returns the latest conversation_id and ordered messages array for that visitor and published agent."
        ),
    },
    {
        "title": "API Reference · Workspace Agents & Account Endpoints",
        "url": "/api-docs#account-api",
        "content": (
            "Workspace APIs (Auth: Authorization: Bearer YOUR_ACCOUNT_API_KEY):\n"
            "- GET /api/v1/bots — List your agents, IDs, public keys, and publication status.\n"
            "- POST /api/v1/bots — Create a new agent (name required 1-80 chars, description optional up to 500 chars).\n"
            "- GET /api/v1/bots/{bot_id} — Read one owned agent.\n"
            "- PATCH /api/v1/bots/{bot_id} — Update name, description, system_prompt, threshold (0.05-0.95), published (boolean), or widget_config.\n"
            "- DELETE /api/v1/bots/{bot_id} — Permanently delete an agent.\n"
            "- GET /api/v1/bots/{bot_id}/conversations?page={page} — List agent conversations (20 per page).\n"
            "- GET /api/v1/account/usage — Read plan, limits, agent/document counts, subscription & top-up tokens.\n"
            "- GET /api/v1/account/token-usage — Read up to 100 latest token usage records.\n"
            "- GET/POST/DELETE /api/v1/account/keys — List, create, or revoke account API keys."
        ),
    },
    {
        "title": "API Reference · Knowledge Upload & Errors",
        "url": "/api-docs#knowledge",
        "content": (
            "Knowledge Endpoints (Auth: Authorization: Bearer YOUR_ACCOUNT_API_KEY):\n"
            "- GET /api/v1/bots/{bot_id}/documents — List attached documents/URLs and status.\n"
            "- POST /api/v1/bots/{bot_id}/documents — Add text (content) or public URL (url) source (returns HTTP 202 while indexing).\n"
            "- POST /api/v1/bots/{bot_id}/documents/upload — Multipart form upload ('file' field) for PDF, DOCX, TXT, or Markdown under 10 MB.\n"
            "- DELETE /api/v1/bots/{bot_id}/documents/{doc_id} — Delete a source.\n\n"
            "Errors & Limits (/api-docs#errors): 401 Invalid API key, 403 Permission/plan limit reached, 404 Not found, 422 Validation failed, "
            "429 Rate limit (30 chat requests/minute per agent & IP) or out of token credits, 502 Provider error."
        ),
    },
]


def index_site_knowledge_sync(db, item: SiteBotKnowledge) -> int:
    """Chunk and locally embed a SiteBotKnowledge article cleanly inside synchronous setup."""
    db.query(SiteBotChunk).filter_by(knowledge_id=item.id).delete()
    chunks = chunk_text(item.content or "")
    for i, text in enumerate(chunks):
        db.add(
            SiteBotChunk(
                knowledge_id=item.id,
                content=text,
                embedding=embed(text),
                embedding_model="local:feature-hash-256",
                ordinal=i,
            )
        )
    item.chunk_count = len(chunks)
    item.updated_at = now()
    return len(chunks)


def ensure_site_bot_seeded(db) -> SiteBotConfig:
    """Ensure Sloty config, starter knowledge base, and walkthrough guides exist."""
    config = db.get(SiteBotConfig, "default")
    if not config:
        config = SiteBotConfig(
            id="default",
            enabled=1,
            name="Sloty",
            tagline="Your AI companion across the platform",
            greeting=(
                "Hey there! I'm Sloty — your friendly platform companion. "
                "Ask me how anything works or check the API docs, ask me to take you to a page, "
                "or let me spotlight what to click step-by-step!"
            ),
            system_prompt=(
                "You are Sloty, a warm, encouraging companion guide built directly into this platform. "
                "Speak naturally like a helpful teammate, cite facts from the platform knowledge base and API "
                "documentation, help users build agents step-by-step, trigger interactive pulsating walkthroughs "
                "when they want hands-on guidance, and offer page redirects whenever helpful."
            ),
            accent_color="#bf5b00",
            position="right",
            include_api_docs=1,
            suggested_prompts=DEFAULT_SUGGESTED_PROMPTS,
            updated_at=now(),
        )
        db.add(config)
        db.flush()

    if not db.get(AppSetting, "site_bot_seed_v1"):
        if not db.query(SiteBotKnowledge).count():
            for article in DEFAULT_KNOWLEDGE_ARTICLES:
                item = SiteBotKnowledge(
                    title=article["title"],
                    source_type="text",
                    content=article["content"],
                    enabled=1,
                )
                db.add(item)
                db.flush()
                index_site_knowledge_sync(db, item)
        if not db.query(SiteBotWalkthrough).count():
            for guide in DEFAULT_WALKTHROUGHS:
                db.add(
                    SiteBotWalkthrough(
                        slug=guide["slug"],
                        title=guide["title"],
                        description=guide["description"],
                        keywords=guide["keywords"],
                        steps=guide["steps"],
                        enabled=1,
                        position=guide["position"],
                    )
                )
        db.add(AppSetting(key="site_bot_seed_v1", value="seeded", updated_at=now()))
        db.commit()
    return config
