# Implementation notes

The supplied Word document describes an eight-week SaaS roadmap. This repository implements its builder, chat, analytics, quality loop, and billing flows, plus optional production service adapters. The document itself explicitly defers Notion and Google Drive ingestion to v2. Team roles, a marketplace, channel integrations, and public gallery are future or stretch scope.

## Architecture choices

Local development uses SQLite and deterministic feature-hash vectors so the complete user flow can run without paid credentials. Hosted deployments use PostgreSQL with pgvector HNSW and a GIN full-text index. Both retrieval paths apply BM25 scoring and RRF candidate fusion followed by lexical coverage or optional Cohere reranking. OpenAI embeddings use 256 dimensions to keep the index small; this is an intentional change from the document's illustrative 1536-dimensional schema. An embedding model identifier accompanies every chunk, so mixed indexes are queried using the appropriate embedding provider.

Chunking uses a 512-word window with 77-word overlap, rather than claiming exact model-token boundaries. This is predictable locally and should be replaced by tokenizer-aware recursive splitting when tuning retrieval quality on a representative corpus. Model costs are estimates using configurable per-million-token prices; each provider's invoice remains authoritative.

In local mode, ingestion uses FastAPI background tasks with document status persisted in the database. Production Compose runs Redis and Celery, acknowledges tasks after work, claims documents atomically, retries failures three times, and periodically recovers pending or stale jobs. Parsing occurs in the API's background thread before indexing; isolated parsing subprocesses are an additional hardening step for hostile uploads. PDF processing validates the signature, limits pages and file size, and requires readable text.

Raw file storage in S3/R2 is optional. Parsed text is retained in the database for repeatable reindexing. Website import fetches one page and rejects redirects, private DNS results, nonstandard ports and oversized content. Multi-page crawling is not implemented. File content is deleted from the searchable database when a source is removed; S3 lifecycle rules must manage raw-object retention.

OpenAI generation streams actual provider deltas. Anthropic is an optional fallback only before any OpenAI text has been delivered, preventing mixed or repeated answers. The six most recent turns are preserved verbatim and earlier available turns are compressed into a bounded extractive dialogue summary. An optional complex model is selected for longer or comparative questions.

Authentication uses local email/password sessions or optional Google OAuth with PKCE and state cookies. This replaces Clerk/Auth.js from the suggested stack while retaining a runnable credential-free default. Account recovery and verified-email enforcement for local signup are not implemented; use an identity provider or implement those flows before an unrestricted public SaaS launch.

The local quality loop uses deterministic extractive grounding/retrieval checks. Opt-in OpenAI evaluations generate up to 20 QA pairs and judge factual support and relevance. These are model-based estimates, not a claim to run the RAGAS library. A hand-authored 50-question golden corpus enforces a 90% retrieval/answer regression gate in CI. Regex guardrails, lexical evidence thresholds, and possible-hallucination flags reduce certain failures; they do not prove semantic faithfulness or defeat all prompt injections.

## External configuration

Live OpenAI/Cohere/Anthropic calls, Google OAuth, Stripe subscriptions, S3/R2 storage and Langfuse export require credentials in server environment variables. Nothing is auto-provisioned, and no real purchase or cloud deployment is performed. Docker Compose includes PostgreSQL, Redis, a Celery worker and the API/web services. Langfuse can use a separately hosted instance or its cloud endpoint.

The Google callback URL must match `GOOGLE_REDIRECT_URI` in both the environment and Google's OAuth client. Stripe expects recurring Pro/Team price IDs and signed events at `/api/v1/webhooks/stripe`. The UI shows unavailable integrations honestly and never pretends a checkout succeeded.

## Deployment verification

Run migrations as a release step with `python -m services.api.migrations`. Bootstrap runs them automatically too; PostgreSQL requires permission to install the vector extension. Configure trusted HTTPS origins and use the same site for API and dashboard. Keep database and Redis private, set a real database password, and disable proxy buffering for SSE. The public widget can be embedded on any website because it loads a hosted chat iframe and does not require owner cookies.

The backend test suite exercises owner access, public chat, quotas, retrieval, ingestion and billing signatures. Provider adapters are tested with deterministic mocked HTTP responses, so test runs do not spend money or transmit sources. CI also runs those tests against a pgvector PostgreSQL service. Actual vendor accounts must still be verified in their test environments, and 100-concurrent-stream performance must be measured on the intended host before making a capacity claim.
