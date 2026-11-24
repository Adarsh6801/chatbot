# AgentForge

Build a document-grounded support agent, test its cited answers, publish an embeddable widget, and improve it from real conversation feedback.

```mermaid
flowchart LR
    Owner[Owner dashboard / Next.js] --> API[FastAPI]
    Visitor[Hosted chat / embed widget] --> SSE[SSE chat endpoint]
    SSE --> RAG[BM25 + vector cosine → RRF → rerank]
    RAG --> Generator[Local extractive / OpenAI stream / Anthropic fallback]
    API --> DB[(SQLite locally / PostgreSQL)]
    API --> Queue[Redis / Celery]
    Queue --> Ingest[Parse → chunk → embed]
    Ingest --> DB
    RAG --> DB
    SSE --> Traces[Conversations / traces / flags]
    Traces --> DB
    Owner --> Fix[Verified answer → retrain]
    Fix --> Ingest
    API --> Stripe[Stripe checkout + signed webhooks]
    Traces --> Langfuse[Optional Langfuse export]
```

## Run locally

Requirements: Python 3.11+, Node.js 22+, npm. No paid account or AI key is needed for the local extractive engine.

On Windows, run `powershell -ExecutionPolicy Bypass -File scripts/start.ps1`. It installs dependencies, starts the API and admin console, and runs the customer web app. Press Ctrl+C to stop the processes.

The customer site has a public landing page at `/` and an About page at `/about`. After signing in, open `/agents`; each agent has dedicated routes such as `/agents/<agent-id>/workflow`, `/knowledge`, `/playground`, `/analytics`, `/conversations`, `/improve`, `/deploy`, and `/settings` (append each view to the agent URL). Workspace-wide analytics and conversations are `/analytics` and `/conversations`; plan and billing is `/plans`.

### Global admin panel

The standalone global admin console runs at `http://localhost:3001`, separately from the customer dashboard. To grant access, first run the app and create/sign in to your account. In the same browser, open `http://localhost:8000/api/v1/auth/me` and copy the `id` value. Stop the app, set `ADMIN_USER_ID=<that id>` in the root `.env`, and restart. Sign in to the admin console with that account. The API checks this ID on every admin request; an email address alone does not grant access. Admins can search all accounts, change plans, suspend/reactivate accounts, publish/unpublish agents, inspect global conversations, select Stripe or Razorpay for new checkouts, and review the admin audit log. Suspending an account revokes its active sessions and API keys. A Stripe webhook can later resync a manually changed plan for accounts with an active Stripe subscription.

Or start the API and each frontend in separate terminals from the repository root:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r services/api/requirements.txt
.venv/Scripts/python -m uvicorn services.api.main:app --reload --port 8000
```

```powershell
cd apps/web
npm ci
npm run dev
```

Run the admin console separately in another terminal:

```powershell
cd apps/admin
npm ci
npm run dev
```

On macOS/Linux, use `.venv/bin/python` instead. Open http://localhost:3000. The API explorer is at http://localhost:8000/docs. Use `localhost` for both services, rather than mixing it with `127.0.0.1`, so session cookies have the same site.

Create an account with a password of at least 10 characters. Click **Try a demo** for sample knowledge, or create an agent and add your own sources. Ask “What does the Free plan include?” in Playground. Inspect citations, then ask an uncovered question. Open Improve, add a verified answer, and ask again. Publish from Deploy to enable the hosted page and widget.

## Implemented

- Email/password authentication with scrypt hashes, expiring opaque HttpOnly sessions, origin checks, optional Google OAuth with PKCE, and owner-scoped API keys with revocation.
- Multi-agent CRUD, per-owner access checks, Free/Pro/Team quotas, serialized monthly message accounting, Redis rate limiting and an atomic shared database fallback.
- PDF, DOCX, UTF-8 text and Markdown ingestion, public HTML/plain-text URL import, asynchronous indexing, persisted status, retries, and restart recovery.
- 512-word chunks with 77-word overlap; local 256-dimension feature hashing or OpenAI semantic embeddings; BM25, cosine search, RRF and optional Cohere reranking. PostgreSQL uses indexed pgvector HNSW and full-text GIN candidate retrieval.
- Actual provider SSE token streaming, chunk citations, bounded dialogue summary plus recent turns, optional complex-model routing, evidence-threshold abstention, injection filtering, and Anthropic fallback.
- Conversation logs with full retrieval/model/token/cost/latency traces; confidence, abstention, p95 latency, cost and activity analytics.
- Flagging uncovered, low-confidence, injection, and negative-sentiment questions. A verified answer becomes a new knowledge source via Save & train.
- Deterministic extractive retrieval checks and optional LLM synthetic-QA/judge evaluation, with labeled run history. A 50-question hand-authored golden corpus gates CI at 90%. These are custom evaluation metrics rather than RAGAS library scores.
- Configurable greeting, accent color, widget position, hosted chat, and a vanilla JavaScript Web Component embed.
- Stripe subscription checkout, customer portal, signature verification, idempotent webhook handling and plan synchronization. Billing stays disabled without credentials.
- Redis/Celery workers with persisted-job recovery, optional S3/R2 raw storage, Langfuse trace export, responsive Next.js dashboard, tests, CI and Docker Compose.
- User profiles with Google account linking, a visible account menu/logout, subscription controls, and an in-app service setup guide.
- Visual Workflow Studio with drag-and-connect nodes, intents, captured variables, conditions, protected API calls, knowledge retrieval, draft testing, versioned publishing and optional execution in live chat.

See [workflow guide](docs/WORKFLOWS.md) for configuration and runtime behavior.

The proposed student learning portal is documented separately in [Phase Two: Student Learning Platform](docs/PHASE_2_STUDENT_LEARNING_PLATFORM.md). It is a planning specification; learner functionality is not implemented by this document.

## Configuration

Copy `.env.example` to `.env` at the repository root. The API reads this file on startup. For the frontend, put `NEXT_PUBLIC_API_URL` into `apps/web/.env.local` when changing the API host (Next.js loads environment files from that directory). `NEXT_PUBLIC_*` values are baked into production builds.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite by default; production can use `postgresql+psycopg://user:password@host/db` |
| `WEB_ORIGIN` | Exact allowed dashboard origin; used for CORS and origin checks |
| `ADMIN_WEB_ORIGIN`, `ADMIN_USER_ID` | Separate admin console origin and the one account authorized for global administration |
| `PUBLIC_WEB_URL` | Hosted chat base URL and billing return URLs |
| `APP_ENV=production` | Enables Secure cookies; use HTTPS |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Enable live language-model generation |
| `COHERE_API_KEY` | Enable cross-encoder reranking |
| `EMBEDDING_PROVIDER=openai` | Use OpenAI semantic embeddings; default `local` |
| `REDIS_URL` | Enable Celery queue and Redis rate limiting; Compose configures this |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `AWS_*` | Optional raw file storage in S3 or R2 |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Optional external trace export |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Optional Google OAuth |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Fallback if OpenAI fails before delivering text |
| `EVAL_PROVIDER=openai`, `EVAL_SAMPLE_SIZE` | Enable paid synthetic QA evaluation, up to 20 samples |
| `OPENAI_COMPLEX_MODEL` | Optional model for longer or comparative questions |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Enable billing and verify incoming Stripe events |
| `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID` | Recurring price IDs from your Stripe account |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | API credentials and webhook signature secret for Razorpay |
| `RAZORPAY_PRO_PLAN_ID`, `RAZORPAY_TEAM_PLAN_ID` | Recurring Razorpay subscription plan IDs |
| `PAYMENT_PROVIDER` | Initial gateway (`stripe` or `razorpay`); the admin console selection is stored in the database |
| `INPUT_COST_PER_MILLION`, `OUTPUT_COST_PER_MILLION` | Token price estimates in USD, defaulting to the small-model estimate |

Stripe webhook endpoint: `/api/v1/webhooks/stripe`. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Razorpay webhook endpoint: `/api/v1/webhooks/razorpay`; subscribe to `subscription.activated`, `subscription.charged`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, and `subscription.halted`. Use each provider's test credentials and matching test-mode plans/webhooks first. The server grants or removes paid access only from verified, deduplicated webhook events; a browser return alone does not upgrade an account. Select the active gateway in **Admin console → Payment provider**. Gateway credentials remain in the API environment, while the admin console stores only the selected provider.

Create monthly recurring Pro and Team plans in Razorpay and place their plan IDs in `.env`. The plan currency and amount are defined by Razorpay; ensure they match the pricing you intend to offer. Configure the Razorpay webhook secret in both the Razorpay dashboard and `RAZORPAY_WEBHOOK_SECRET`.

```html
<script src="http://localhost:8000/widget.js"
        data-agent-key="YOUR_PUBLISHED_AGENT_PUBLIC_KEY" async></script>
```

Use HTTPS URLs when embedding on an HTTPS site. The published widget is an iframe of the hosted chat page and works without owner session cookies.

## Verify

```powershell
python -m pytest services/api/tests -q
cd apps/web
npm run typecheck
npm run build
```

The backend tests cover authentication, tenant isolation, ingestion, cited SSE answers, abstention and fixes, injection flags, publishing, conversation ownership, quotas, key revocation, upload validation, URL restrictions, source deletion, CORS, CSRF, provider streams/fallback, and signed Stripe events. Tests use mocked external providers and do not spend API credits. CI includes SQLite and PostgreSQL jobs.

## Docker

```sh
docker compose up --build
```

The customer app is at port 3000, the standalone admin console at 3001, and the API at 8000. PostgreSQL and Redis data persist in named volumes. Set `POSTGRES_PASSWORD` before deploying. Use a reverse proxy with HTTPS, exact public origins, request body limits, and SSE buffering disabled. A same-site API/dashboard deployment is recommended for cookies. The versioned bootstrap migration runs on startup; `python -m services.api.migrations` also applies it as a release step. Back up data before future schema changes.

## Scope and production limits

The builder and quality-loop MVP is runnable end to end. External adapters require service credentials. The following remain additional hardening or future scope:

- Password reset and local-signup email verification; organizations and team roles.
- Ollama embeddings, tokenizer-aware recursive splitting, multi-page crawling, Notion and Drive connectors (the source document defers those connectors to v2).
- Isolated file-parser subprocesses, semantic adversarial evaluation, public gallery and 100-concurrent-stream load validation.
- Rigorous adversarial defenses and semantic faithfulness checking. Regex filtering and lexical confidence reduce some failures but are not a complete injection or hallucination defense.

URL import rejects non-public resolved addresses, nonstandard ports and redirects, and pins the validated address. It imports a single page. PDF extraction requires a text layer; OCR is outside this implementation. Raw object retention is managed by your bucket's lifecycle policy. Run one API process when using local background tasks; use Redis/Celery for production workers. No provider accounts, cloud deployment, or actual payments have been provisioned.

See [implementation notes](docs/IMPLEMENTATION.md) for exact design deviations, deployment requirements and verification limits.
See [verification record](docs/VERIFICATION.md) for the checks run in this workspace and their limits.

## Repository

```text
apps/web/             Next.js dashboard and hosted chat
apps/admin/           Separate Next.js global admin console
apps/widget/          Framework-independent embed script
services/api/         FastAPI, SQLAlchemy, ingestion and retrieval
services/api/tests/   Unit and API integration coverage
infra/                Container definitions
scripts/              Local launch helper
.github/workflows/    CI checks
```


| Block | What it does |
|---|---|
| **Detect intent** | Compares the visitor’s message against the example phrases you entered for each intent, then follows the closest matching route. This is a simple word-overlap matcher, **not an AI intent classifier**. Unmatched messages follow “Otherwise.” |
| **Send message** | Adds the configured text to the response. You can insert saved values such as `{{email}}`. |
| **Collect information** | Asks the visitor a question, pauses the workflow, and saves their reply in that conversation. It can validate text, email, or number. It doesn’t automatically look up private client information. |
| **Check condition** | Checks a saved value and follows the True or False route. Available checks include equals, contains, exists, and greater than. |
| **Call an API** | Makes a server-side request to the configured public HTTP(S) endpoint. It can use captured values in the URL or request body, save the result for later nodes, and follow success or error routes. |
| **Search knowledge** | Searches this agent’s indexed documents for the configured question, normally `{{message}}`, and responds with evidence/citations or abstains if evidence is weak. |
| **End** | Stops the current workflow run. Saved conversation values can be available to later messages in that conversation. |
