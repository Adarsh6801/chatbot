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

On Windows, run `powershell -ExecutionPolicy Bypass -File scripts/start.ps1`. It installs dependencies, starts the API, and runs the web app. Press Ctrl+C to stop both.

Or start two terminals from the repository root:

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

## Configuration

Copy `.env.example` to `.env` at the repository root. The API reads this file on startup. For the frontend, put `NEXT_PUBLIC_API_URL` into `apps/web/.env.local` when changing the API host (Next.js loads environment files from that directory). `NEXT_PUBLIC_*` values are baked into production builds.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite by default; production can use `postgresql+psycopg://user:password@host/db` |
| `WEB_ORIGIN` | Exact allowed dashboard origin; used for CORS and origin checks |
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
| `INPUT_COST_PER_MILLION`, `OUTPUT_COST_PER_MILLION` | Token price estimates in USD, defaulting to the small-model estimate |

Stripe webhook endpoint: `/api/v1/webhooks/stripe`. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Use Stripe test mode first. The server sets a paid plan only from verified payment/subscription events; checkout alone does not upgrade the account.

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

The app is at port 3000 and the API at 8000. PostgreSQL and Redis data persist in named volumes. Set `POSTGRES_PASSWORD` before deploying. Use a reverse proxy with HTTPS, exact public origins, request body limits, and SSE buffering disabled. A same-site API/dashboard deployment is recommended for cookies. The versioned bootstrap migration runs on startup; `python -m services.api.migrations` also applies it as a release step. Back up data before future schema changes.

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
apps/widget/          Framework-independent embed script
services/api/         FastAPI, SQLAlchemy, ingestion and retrieval
services/api/tests/   Unit and API integration coverage
infra/                Container definitions
scripts/              Local launch helper
.github/workflows/    CI checks
```
