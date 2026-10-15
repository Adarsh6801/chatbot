# Verification record

Verified locally on 14 October 2026:

- 33 backend tests passed, including the 50-question golden retrieval gate.
- Next.js production build and TypeScript checks passed.
- npm dependency audit reported zero vulnerabilities after updating Next.js.
- Docker Compose configuration validated. The container stack was not launched because the Docker Desktop engine was stopped.
- Browser registration, sample-agent creation, cited answers, abstention, flagged-question fixes, retrained answers, public publishing and hosted chat were exercised.
- Desktop and a 390-pixel mobile breakpoint were visually inspected; the mobile page had no horizontal document overflow.
- The standalone widget loaded and opened its hosted chat iframe. The browser automation interface could fill its question input but failed to target the nested submit control; hosted-chat submission was verified separately.

OpenAI, Anthropic, Cohere and Stripe adapters were verified using mocked HTTP responses or test-signed webhook payloads. Google OAuth state rejection and unconfigured behavior were verified; a real Google login was not performed. S3/R2, Redis/Celery, Langfuse and PostgreSQL runtime behavior still require the configured integration environment; the CI workflow includes a PostgreSQL service job, but no CI run has been initiated from this workspace.

The local application is a portfolio MVP. Public launch also requires verified external credentials, HTTPS deployment, identity/account-recovery hardening, data-retention policies and capacity testing described in IMPLEMENTATION.md.

## Account and workflow extension

The extension passes 47 backend tests, including Google registration/linking with mocked OAuth responses, profile edits, logout, draft-versus-published workflow behavior, intent routing, captured-value validation/resumption, conditions, API response mapping, API error-to-knowledge fallback, encrypted authorization, private-network blocking, pinned API transport, knowledge-provider failures and workflow tenant/CSRF checks. The Next.js production build and TypeScript checks also pass.

Real Google sign-in and Stripe checkout still need workspace credentials. No live OAuth client or paid subscription was created by this work.
