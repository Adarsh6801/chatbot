# Phase Two: Student Learning Platform

**Status:** Product and engineering plan  
**Product area:** Learner portal, adaptive study planning, and learner subscriptions  
**Relationship to Phase One:** A separate product experience in the existing AgentForge application. It does not live inside the agent-builder workspace.

## Contents

1. [Product summary](#1-product-summary)
2. [Product boundaries](#2-product-boundaries)
3. [Product principles](#3-product-principles)
4. [Personas and access](#4-personas-and-access)
5. [Learner experience and routes](#5-learner-experience-and-routes)
6. [Core learner journeys](#6-core-learner-journeys)
7. [AI planning and teaching behavior](#7-ai-planning-and-teaching-behavior)
8. [Subscription, trial, and entitlements](#8-subscription-trial-and-entitlements)
9. [Student administration area](#9-student-administration-area)
10. [Proposed architecture and data model](#10-proposed-architecture-and-data-model)
11. [API surface proposal](#11-api-surface-proposal)
12. [Lifecycle and edge-case behavior](#12-lifecycle-and-edge-case-behavior)
13. [Security, privacy, and reliability](#13-security-privacy-and-reliability)
14. [Analytics and operational signals](#14-analytics-and-operational-signals)
15. [Acceptance criteria](#15-acceptance-criteria-for-the-first-production-release)
16. [Delivery plan](#16-delivery-plan)
17. [Decisions to confirm](#17-decisions-to-confirm-before-implementation)
18. [Success measures](#18-phase-two-success-measures)

## 1. Product summary

Phase Two adds a student-facing learning portal where a learner describes a subject, their goal, their current knowledge, and the time they can spend. A learning agent turns that information into an editable study roadmap, teaches individual topics, answers broader subject questions, and tracks progress as the learner marks topics complete.

The experience is designed to make learning feel approachable and guided. It should ask short, relevant questions when it needs to establish prerequisite knowledge, explain why the question matters, and let the learner correct the resulting plan. The agent should guide and teach rather than silently decide what a learner knows.

Learners get a 10-day trial and then use a subscription whose entitlements can account for active subjects, planned lessons/topics, and AI usage. Razorpay is the student billing provider. Administrators manage the learner catalog, trial policy, active learner subscriptions, and platform activity from a separate **Students** area in the existing standalone admin console.

## 2. Product boundaries

### In scope

- A dedicated learner entry point and learner portal, separate from creating and managing support agents.
- Learner profiles, subjects, goals, initial knowledge, study plans, topics, resources, progress, and learning conversations.
- AI-assisted intake, plan generation, topic and subject chat, plan editing, progress tracking, and optional knowledge checks.
- A 10-day trial, subscription catalog, entitlements, usage metering, Razorpay checkout, renewals, cancellation, and webhook reconciliation.
- A dedicated global-admin section for student operations, subscription management, usage, support, and audit history.
- A clear route and authorization boundary between the learner portal, creator workspace, and admin console.

### Not part of the first learner release

- Teacher, classroom, school, cohort, parent, or learning-management-system accounts.
- Public user-generated course catalogs or sharing study plans between learners.
- Unreviewed AI-generated lessons presented as authoritative course material.
- Automatic payments beyond the selected subscription and disclosed entitlements.
- Using learner conversations or profile data to train models by default.

## 3. Product principles

1. **Learner agency:** the learner can inspect, edit, reorder, pause, and delete their plan.
2. **Small, explainable steps:** show a useful next action and explain why it belongs in the roadmap.
3. **Ask before adding a prerequisite:** identify a possible gap, ask a concise question, then incorporate a prerequisite only when the learner confirms it or a short diagnostic indicates it is needed.
4. **Do not pretend certainty:** distinguish learner-provided information, diagnostic results, and AI estimates.
5. **Progress is not payment:** learning progress remains available after a trial or subscription ends, subject to the product’s stated read/export policy.
6. **No surprise charges:** quotas and renewal terms are visible; usage overages are off unless explicitly offered and accepted.
7. **Private by default:** a learner’s subjects, plan, and chat are visible to that learner. Admin access to message contents is restricted, justified, and audited.
8. **Useful without AI:** preserve the learner’s saved roadmap and completed topics if an AI provider or Razorpay is unavailable.

## 4. Personas and access

| Persona | Main need | Access |
|---|---|---|
| Learner | Understand a subject, follow a realistic plan, ask questions, and see progress | Own learner profile, subjects, plans, chats, resources, and billing |
| Platform administrator | Operate the learner product and resolve account or billing issues | Student directory, plan catalog, subscription actions, usage summaries, and audited support access |
| Support operator (future role) | Help with learner issues without broad platform powers | Narrow support permissions; no plan-catalog or global configuration access by default |

Phase One currently authorizes a global admin through `ADMIN_USER_ID`. Phase Two should extend API authorization with explicit roles and permissions rather than relying on frontend visibility. The existing creator account may also be a learner; product-area membership should not require duplicate accounts.

## 5. Learner experience and routes

Suggested public and signed-in routes:

- `/learn` — student product overview and learner-specific call to action.
- `/learn/sign-in` and `/learn/sign-up` — learner entry, reusing the secure account system where appropriate.
- `/learn/dashboard` — next study action, active subjects, progress, and trial/subscription state.
- `/learn/subjects` — subject list and create-subject entry point.
- `/learn/subjects/new` — guided subject intake.
- `/learn/subjects/{subjectId}` — subject overview and roadmap.
- `/learn/subjects/{subjectId}/topics/{topicId}` — topic lesson, chat, resources, check, and completion action.
- `/learn/subjects/{subjectId}/chat` — subject-wide conversation.
- `/learn/billing` — plan, trial countdown, usage, payment, invoices/receipts, and cancellation controls.
- `/learn/settings` — profile, learning preferences, privacy, data export, and account deletion.

The creator workspace remains on its existing routes (`/agents/...`). The learner header and navigation must not show creator tools as if they were part of the study experience. Accounts with both products can use a clearly labelled product switcher.

## 6. Core learner journeys

### 6.1 First visit and account creation

1. The learner arrives at `/learn` and sees the product purpose, how the 10-day trial works, what is included, and a clear start button.
2. They sign in or create an account. Before trial activation, show the trial duration, selected offer, renewal behavior, and payment-method requirement.
3. The system creates or resumes the learner profile. It must not create duplicate profiles on retries.
4. The learner lands on `/learn/dashboard` with a short setup checklist and an empty state that explains how to add the first subject.

If trial policy requires a payment method, disclose whether the plan converts automatically at trial end and how to cancel. If no payment method is required, the trial expires to the free/read-only policy without silently enrolling the learner in a paid plan.

### 6.2 Add a subject and establish a goal

The subject intake should be a short, save-as-you-go flow, not a long form. Collect:

- Subject name and optional syllabus, exam, course, or target outcome.
- What the learner wants to be able to do and why; accept free-text goals.
- Current confidence or prior exposure, using “I’m new,” “I know some,” “I’m comfortable,” and “not sure” rather than forcing a numeric score.
- Preferred pace, available time per week, target date if any, preferred explanation style, and language.
- Optional known topics, resources, and accessibility preferences.

Validate length and content, save the draft before AI generation, and allow the learner to return later. A learner can use a broad subject label such as “Machine Learning” without already knowing a formal syllabus.

### 6.3 Adaptive prerequisite check

1. The planning service creates an initial concept map and detects prerequisites that may be relevant.
2. It compares prerequisite candidates with learner-provided knowledge and confidence.
3. For an unknown prerequisite, it asks one or a small number of targeted questions, for example: “Machine learning uses Python examples. Have you written basic Python before?”
4. If the learner confirms they know it, record that as learner-reported and omit the prerequisite or mark it as optional review.
5. If they say no or are unsure, explain the dependency and offer a brief diagnostic or a starter topic. Add it to the plan only after the learner chooses to include it or the diagnostic shows a clear gap.
6. Let the learner change the answer later; regenerate only affected recommendations and show the proposed changes.

Do not repeatedly quiz a learner about a prerequisite they have already confirmed. Do not treat silence, a skipped answer, or a failed generation as evidence that the learner lacks the skill.

### 6.4 Generate and review the roadmap

Generate a draft roadmap with:

- A short plan summary tied to the learner’s stated goal.
- Ordered phases, topics, and estimated effort/duration.
- For each topic: title, plain-language description, learning outcomes, prerequisite links, suggested activities, and optional verified learning resources.
- A clear first recommended topic and a visible explanation of why it comes first.
- Optional checkpoints or self-tests; do not claim mastery from topic completion alone.

Show the complete draft for review before activating it. The learner can rename, remove, add, or reorder topics; change descriptions and pace; mark a topic optional; and ask the AI to revise the plan. Display prerequisite warnings when a reorder places a topic before a required foundation, but let the learner override with a clear explanation.

### 6.5 Learn a topic

The topic page should provide:

- Topic title, purpose, learning outcomes, estimate, prerequisites, and current status.
- A concise lesson or guided outline with examples appropriate to the stated level.
- Topic-specific chat and a separate subject-wide chat.
- Verified resources and optional self-check questions.
- “Mark complete,” “Continue later,” and “I need help” actions.

Marking complete is a learner action and is reversible. The system may suggest a short understanding check but must not block completion unless a specific plan policy says so. If the learner’s chat reveals a gap, offer an optional plan change rather than silently rewriting the active roadmap.

### 6.6 Chat-driven changes

Learners can ask questions in the selected topic context or broader subject context. They can also request changes such as “split this topic into smaller lessons” or “move linear algebra before neural networks.”

When chat proposes a persistent plan edit:

1. Produce a structured change proposal, not an unreviewable direct database mutation.
2. Show the before/after summary, affected topics, dependency changes, and any quota usage.
3. Let the learner apply, edit, or discard the proposal.
4. Save an immutable plan revision and provide undo/restore to a prior revision.

Ordinary explanations and chat answers must not change plan data. The chat should explain when a request cannot be completed, preserve context, and offer a smaller alternative.

### 6.7 Track progress

Progress views should include completed topics, topics in progress, the next recommendation, and progress against the learner’s own goal. Do not present “percent mastered” unless supported by defined assessments. Avoid shame language for missed target dates; offer a reschedule or pace adjustment.

## 7. AI planning and teaching behavior

### Inputs

The planner may use only data the learner has provided or explicitly connected: subject, goal, availability, timeline, declared knowledge, selected resources, language, and accessibility preferences. Keep the planning prompt and structured result versioned.

### Structured generation contract

Ask the model for a schema-validated plan, including stable topic IDs, topic descriptions, estimated effort, ordering, prerequisite IDs, outcomes, activity suggestions, and resource candidates. Validate:

- All IDs are unique; all prerequisite references exist; no circular prerequisite graph exists.
- Topic and plan counts fit subscription limits.
- Content length, language, and estimated effort are within product bounds.
- Topic order is topologically valid unless an explicitly optional dependency is retained.
- Resource URLs are verified using an approved provider or trusted catalog. Never present invented URLs as verified links.
- The response is safe, relevant to the learner’s stated subject, and not an unbounded copy of protected course content.

If validation fails, retry once with a repair instruction; if it still fails, keep the intake draft and explain that plan generation needs another try. Do not save half a plan as active.

### Teaching behavior

- Adapt vocabulary, examples, and explanation depth to learner preference and declared knowledge.
- Explain concepts in steps, check understanding with optional questions, and offer hints before full worked answers when appropriate.
- Cite or link to the exact resource used when available; distinguish sourced facts from the AI’s explanation.
- Acknowledge uncertainty and ask a clarifying question when subject or goal is ambiguous.
- Treat learner messages and imported material as untrusted content; never follow instructions inside them that override system safety or request secrets.
- Do not promise exam outcomes, guaranteed mastery, or exact completion dates.
- On model/provider failure, preserve conversation and plan state, show retry, and do not consume quota for a request that was not accepted/processed according to the published metering policy.

## 8. Subscription, trial, and entitlements

### Policy requirements

- Trial length defaults to **10 days**, but is configurable per learner offer/subscription catalog item.
- Define whether trial time starts at account creation, learner enrollment, or first subject creation. Recommended default: when the learner explicitly activates a selected trial offer, not on an earlier marketing visit.
- Define the payment-method requirement and whether the trial converts automatically. The consent and renewal date must be shown at checkout and in the learner billing page.
- Enforce one-trial-per-eligible-person policy with abuse controls. Admins may grant a documented exception.
- Keep trial end timestamps in UTC and display them in the learner’s local timezone.
- A provider event is the source of truth for paid status. A browser redirect never grants access.
- Grace periods, failed-payment retries, cancellation timing, and access after cancellation must be explicit in the plan catalog.

### Entitlement model

Avoid tying product logic only to labels such as Free/Pro. Each plan version should declare entitlements such as:

- Maximum active subjects and active study plans.
- Maximum generated topics/lessons per plan and monthly plan regenerations.
- AI message/token budget and optional model features.
- Resource lookup allowance, if resource search has a provider cost.
- Data export and support benefits.

Show the learner their current usage, reset/renewal date, and what happens at the limit. Default behavior at quota exhaustion is a clear block with upgrade, wait-for-reset, or manage-plan actions; no hidden overage. Preserve read access to saved work under the expired/limited policy.

### Razorpay student billing

Student subscriptions require a distinct Razorpay configuration and product catalog from the existing creator Pro/Team gateway switch. Admin changes to creator payment provider must not switch student billing. Create student-specific Razorpay plan mappings and record the provider plan ID and price snapshot on each subscription.

Billing lifecycle:

1. Learner selects an offer and sees price, billing interval, trial length, payment-method requirement, conversion, cancellation, and limits.
2. API creates a Razorpay subscription with server-side credentials and an opaque learner reference; browser receives only the hosted checkout URL.
3. Subscription remains pending until a verified event confirms the expected state.
4. Webhook signature is verified over the raw body; event ID is deduplicated; events are reconciled idempotently and out-of-order events do not downgrade a newer state.
5. Store event history and provider identifiers; never store card or bank credentials.
6. Cancellation, failed payment, pause, resume, refund, chargeback, duplicate webhook, delayed webhook, and plan replacement each have an explicit state transition and learner notification.

Use separate endpoints/configuration and test-mode credentials for learner billing. The Phase One global gateway setting must not modify learner subscriptions.

## 9. Student administration area

Add a separate **Students** navigation section in the standalone admin console (`apps/admin`). Keep it visually and permission-wise distinct from creator users, bots, and creator billing.

### 9.1 Students overview

Show aggregate counts and trends: total learners, active learners, trialing, trial ending soon, past due, canceled, active subjects, topics completed, AI usage/cost, plan distribution, and recent billing failures. Provide date filters and CSV export subject to admin permission and audit logging.

### 9.2 Student directory and profile

Search by name, email, learner ID, subscription ID, and subject. The profile view should show:

- Account status, learner creation date, locale/timezone, and privacy/consent state.
- Current and prior subscription states, trial dates, renewal/cancel dates, provider references, plan version, and latest webhook reconciliation.
- Active and archived subjects, plan status, topic progress, and aggregate AI usage.
- Recent events such as subject created, plan activated, topic completed, quota reached, and payment state changed.

Default views must not expose full chat contents. A separate **View conversation for support** action requires an entered reason, permission check, time-limited access, and an immutable audit event. Mask sensitive fields where possible. Do not allow admin impersonation without a separate, controlled, audited feature.

### 9.3 Plan catalog administration

Administrators can create and edit learner offers with:

- Display name, description, availability, price/currency/billing interval.
- Razorpay plan mapping and provider mode (test/live).
- Trial days, payment-method requirement, auto-conversion disclosure, grace period, and cancellation behavior.
- Entitlements and AI model/resource-search allowances.
- Effective dates and an immutable version.

Editing an offer creates a new version. Do not silently change the price or entitlements for active subscriptions. Show which learners are affected and require a planned migration or renewal-only adoption. Validate Razorpay plan mapping before making an offer purchasable. If Razorpay cannot modify a provider plan, create a replacement mapping and preserve historical mapping for existing subscriptions.

### 9.4 Subscription operations

Administrators can:

- View provider state and webhook reconciliation status.
- Extend a trial, grant a time-limited comp subscription, or correct an entitlement with an entered reason and expiry.
- Request cancellation at renewal, restore an eligible subscription, or initiate a plan change at renewal where supported.
- Reconcile a provider state after verifying it against Razorpay; never set an active-paid state solely from a UI toggle.
- Retry a failed webhook reconciliation safely and see the previous result.

For every action, show the before/after state, effective date, whether it contacts Razorpay, and learner notification. Financial actions need an explicit confirmation step and an audit record. The admin tool cannot edit payment credentials or reveal webhook secrets.

### 9.5 Usage and activity monitoring

Provide searchable usage summaries by learner and time period: model requests, input/output tokens or equivalent units, estimated cost, rejected/failed requests, subjects, plans, and topic progress. Use a usage ledger with idempotency keys so a retry cannot double-charge quota. Do not make raw prompt logging the only usage source.

### 9.6 Roles and audit

Use role-based permissions (for example `student.read`, `student.support_read`, `student.subscription.manage`, `student.plan.manage`, `student.export`, `student.admin_access`) enforced by the API. Require least privilege, record actor, target, reason, previous/new values, timestamp, request/event reference, and outcome. Sensitive conversation viewing, exports, comp grants, trial exceptions, manual reconciliation, and catalog publication must be auditable.

## 10. Proposed architecture and data model

Reuse the existing Next.js frontend, FastAPI service, PostgreSQL, Redis/Celery, and Razorpay integration patterns. Keep the learner domain separate from `Bot`, `Document`, creator plan quotas, and creator conversations. Do not use the agent knowledge base as the learner curriculum store.

Suggested domain records (exact table names can be finalized during schema design):

- `learner_profiles`: user reference, preferences, locale, timezone, consent/age-policy fields.
- `learner_subjects`: learner, title, goal, target date, weekly availability, status, selected plan revision.
- `learner_skill_claims`: skill/prerequisite, learner answer, source (`self_report`, `diagnostic`, `inferred`), confidence, updated time.
- `learning_plans`: subject, state (`draft`, `active`, `paused`, `archived`), current revision, generation metadata/version.
- `learning_plan_revisions`: immutable structured snapshot, reason, actor (`learner`/`assistant`/`admin`), and timestamp.
- `learning_topics`: revision/plan reference, stable topic key, order, description, outcomes, estimate, status, optionality.
- `topic_dependencies` and `topic_resources`: prerequisite edges and verified resource metadata/source.
- `learning_conversations` and `learning_messages`: learner/subject/topic scope, citations/resource references, model and usage metadata.
- `learner_plan_catalog` and `learner_plan_versions`: offer definition, entitlements, trial/billing rules, provider mappings.
- `learner_subscriptions`: learner, catalog version, provider IDs, lifecycle status and effective dates.
- `learner_usage_ledger`: metered events, units, cost estimate, idempotency key, period and policy version.
- `learner_admin_audit`: all sensitive admin actions; can share the existing audit infrastructure with typed target references.
- `provider_webhook_events`: provider-scoped, unique event IDs, verification and processing status.

Use foreign keys, indexes on learner/status/date, unique constraints for provider IDs and event IDs, and retention policies. Store the plan snapshot/revision independently so editing a catalog or regenerating a plan cannot rewrite learning history. Store model/provider versions for reproducibility and support.

### Request flow

1. Authenticated learner creates/updates a subject draft.
2. API checks ownership, account state, trial/subscription entitlement, and rate limits.
3. A planning job is enqueued; the learner sees a clear `drafting` state and may leave the page.
4. Worker generates structured plan data, validates dependency graph/resources/limits, then atomically stores a draft revision.
5. Learner reviews and activates it; activation stores a revision pointer and initializes progress.
6. Topic/subject chats are scoped to the learner’s subject, plan revision, and selected topic; usage is recorded once per accepted model request.
7. Verified billing webhooks update subscription entitlements; all learner requests re-evaluate access server-side.

## 11. API surface proposal

All learner APIs are authenticated, owner-scoped, rate limited, and versioned under `/api/v1/learning` (or a consistently chosen `/api/v1/learn` prefix):

- `GET/PUT /profile`
- `GET/POST /subjects`; `GET/PATCH/DELETE /subjects/{id}`
- `POST /subjects/{id}/intake-answers`
- `POST /subjects/{id}/plans/generate`; `GET /subjects/{id}/plans/current`
- `POST /subjects/{id}/plans/{planId}/revisions` for a reviewed change proposal
- `POST /subjects/{id}/plans/{planId}/activate`; `POST /subjects/{id}/plans/{planId}/restore/{revisionId}`
- `PATCH /subjects/{id}/topics/{topicId}` for reorder/status/learner edits
- `POST /subjects/{id}/topics/{topicId}/check` for an optional quiz/check
- `POST /subjects/{id}/chat` and `/subjects/{id}/topics/{topicId}/chat`
- `GET /usage`, `GET /catalog`, `POST /billing/checkout`, `POST /billing/cancel`, `GET /billing/status`
- `POST /webhooks/razorpay/learners` for signed provider events, with an idempotency ledger

Use request IDs and idempotency keys on plan generation, chat, checkout, and state-changing billing actions. Responses should return stable domain status, not provider secrets or raw error dumps.

## 12. Lifecycle and edge-case behavior

| Situation | Required behavior |
|---|---|
| Learner skips skill question | Keep skill unknown; offer a short diagnostic or optional foundation topic. |
| Learner already knows a prerequisite | Record the source of that claim, omit or make the review optional, and allow later correction. |
| Conflicting or ambiguous subject goal | Ask a targeted clarification before generating a detailed roadmap. |
| Learner regenerates plan | Create a proposed revision; preserve completed topics and explain changed/removed topics. Never overwrite progress silently. |
| Learner reorders a prerequisite | Warn about dependency, allow an explicit override where safe, and show resulting plan logic. |
| AI returns malformed/cyclic/over-quota plan | Reject it atomically, keep the previous active plan, and offer retry/edit. |
| Resource URL is unverified, unsafe, broken, or private-network | Do not publish it as a verified recommendation; remove it or label it clearly as learner-provided/unverified. |
| Topic chat requests plan change | Show a structured preview with Apply/Discard; ordinary chat never mutates plan. |
| Learner marks topic complete incorrectly | Allow undo; optional check remains separate from completion state. |
| AI provider is unavailable | Preserve drafts/conversations; show retry and avoid duplicate quota charge. |
| Trial expires during chat or plan generation | Finish or safely stop the accepted request per entitlement policy; preserve data and show a clear renewal/upgrade path. |
| Razorpay webhook is duplicated | Return success after dedupe without duplicate state change or usage/charge. |
| Webhook is delayed or arrives out of order | Store event, reconcile against provider/current version, and do not roll back newer confirmed state. |
| Payment fails or is disputed | Apply documented grace/access policy, notify learner, retain progress, and provide billing actions. |
| Subscription is canceled at period end | Keep entitled access through paid-through date; then apply the stated limited-access policy. |
| Learner is suspended/deleted | Revoke sessions, stop new AI work, retain financial audit, and follow data export/deletion/retention policy. |
| Admin grants comp or trial extension | Require reason, duration, permission, learner notification, and an audit record. |
| Admin reads a conversation | Require support permission and reason; log view access and minimize displayed personal data. |
| Learner reaches a limit | Show exact limit, current use, reset date, and options; do not silently overbill. |
| Network retry submits the same change twice | Idempotency prevents duplicate plan revisions, checkouts, and usage events. |

## 13. Security, privacy, and reliability

- Enforce learner ownership in every query and mutation; do not rely on opaque IDs alone.
- Separate learner roles and entitlements from creator plan checks. A learner must not gain access to another learner’s chats or subjects through guessed IDs.
- Keep payment and model secrets server-side. Verify raw Razorpay webhook signatures and deduplicate provider event IDs.
- Apply per-user and per-IP limits to login, plan generation, chat, resource lookup, and webhook endpoints; avoid charging for rejected/duplicate work.
- Sanitize rendered markdown and external links; validate resources and block private-network URL fetches.
- Encrypt secrets and sensitive credentials at rest; minimize stored profile fields; provide account export and deletion workflows.
- Define message retention and support-access policy before launch. Default model-provider settings must not train on learner data unless the learner explicitly opts in and policy permits it.
- Establish an age eligibility policy and jurisdiction review before marketing to or knowingly onboarding minors. Do not collect birth date unless it is required for an approved policy.
- Maintain audit trails for admin changes and billing events without copying full conversation content into audit details.
- Use transactional state changes for plan activation, revisions, and subscription reconciliation; use outbox/worker patterns when one logical action spans database and queue/provider operations.
- Back up learner records and test restore, deletion, webhook replay, and worker recovery procedures.

## 14. Analytics and operational signals

### Learner-facing

- Active subjects and plan status.
- Topics completed/remaining and next suggested action.
- Trial expiry, subscription status, and usage against entitlements.
- Clear states for plan generation, AI outage, resource lookup, and billing failure.

### Admin-facing

- Signup-to-first-subject and signup-to-first-topic completion.
- Plan generation success/failure and retry rate.
- Learner engagement by aggregate topic/chat usage; do not rank students publicly.
- AI requests, token/usage cost, latency, errors, and quota exhaustion by plan.
- Trial starts/conversions/expiry/cancellation and payment failure/recovery.
- Webhook lag, invalid signature count, reconciliation failure, and duplicate-event count.
- Support views and manual access grants.

Use aggregation and minimum cohort sizes for dashboards where needed. Avoid exposing learner performance details to unrelated administrators or other learners.

## 15. Acceptance criteria for the first production release

### Learner portal

- A learner can sign up/sign in, create a subject, state a goal and time budget, save a draft, and return to it.
- The AI can ask targeted prerequisite questions, preserve unknowns, and produce a schema-valid editable roadmap.
- Learner can reorder topics, see dependency warnings, revise topic details, and restore a previous plan revision.
- Topic and subject chats use the correct context; only explicit, reviewed actions change the plan.
- A learner can view resources, mark/undo completion, and see progress without a false mastery claim.
- Another learner cannot access the subject, chat, usage, or billing data by changing an ID.

### Subscription and billing

- Trial duration and conversion terms are visible before activation and on the billing page.
- A 10-day trial is applied once according to the published eligibility policy; admin exceptions are audited.
- Paid entitlements activate only after a verified, deduplicated Razorpay event.
- Duplicate, delayed, out-of-order, failed, canceled, and resumed events are safe and observable.
- Learner can see plan, usage, renewal/cancel dates, and supported cancellation controls.
- No quota overage or automatic plan change occurs without explicit product policy and learner disclosure.

### Admin

- Admin can search learners and inspect subscription/usage summaries without opening chat contents by default.
- Admin can create/version/publish an offer and validate its Razorpay mapping and entitlements.
- Admin can extend trial, grant/revoke time-limited comp access, request supported subscription actions, and record reasons.
- Sensitive transcript access and exports require permission and create audit events.
- All admin mutations are server-authorized and auditable; secrets are never displayed.

### Reliability and privacy

- AI outage, Redis/worker restart, database retry, and Razorpay outage leave learner work intact and recoverable.
- Plan generation is atomic; idempotent requests do not create duplicate plans or duplicate usage.
- Resource links are validated and rendered safely.
- Learner export/deletion and retention policy are implemented and documented before general availability.
- Production monitoring alerts on worker failure, elevated AI errors/cost, webhook backlog, and payment reconciliation failures.

## 16. Delivery plan

1. **Product decisions and contract:** finalize trial conversion/payment-method policy, currency/price catalog, entitlements, age policy, retention, and admin permission matrix.
2. **Domain foundation:** add learner tables, migrations, role/ownership checks, usage ledger, audit events, and API schemas.
3. **Learner portal shell:** implement `/learn` routes, learner navigation, profile/preferences, subject CRUD, save-as-you-go intake, and empty/loading/error states.
4. **Planning engine:** schema-constrained generation, prerequisite questioning, validation, plan revisions, resource verification, and failure recovery.
5. **Learning loop:** topic and subject chats, contextual resources, self-checks, progress, plan-change preview/undo, and usage metering.
6. **Billing:** learner-specific Razorpay catalog mappings, trial lifecycle, checkout/cancellation, webhook reconciliation, and learner billing UI.
7. **Student admin:** directory, profile, catalog, subscription operations, usage monitoring, audited support access, role enforcement, and notification flows.
8. **Closed beta:** invite a limited group, review plan relevance and cost/latency, improve onboarding and support workflows, and validate deletion/export.
9. **Production readiness:** load/security review, webhook replay drills, restore drills, support runbooks, alerts, pricing verification, and gradual rollout.

Each phase should be released behind a feature flag. Keep the creator agent-builder routes and their existing Stripe/Razorpay gateway selection isolated from learner billing.

## 17. Decisions to confirm before implementation

The following are intentionally open; the suggested defaults let engineering progress once product owners approve them:

1. **Trial payment method and conversion:** choose whether a card/mandate is collected at trial start and whether paid conversion is automatic. Default recommendation: disclose clearly, require explicit consent, and send reminders before the end date.
2. **Trial eligibility:** once per account, verified email, or other policy? Default: one trial per account, with abuse detection and auditable admin exceptions.
3. **Pricing and currencies:** define Razorpay prices, intervals, tax display, refund policy, and whether usage is included or metered. Default: fixed plan tiers with disclosed AI quotas; no surprise overage.
4. **Entitlement behavior after expiry:** read-only access to saved plan/progress is recommended; define whether chat and edits are disabled or limited.
5. **Age policy and target learner segments:** define eligible ages/regions and required guardian or consent handling before public launch.
6. **Resource discovery:** select an approved search/content source or ship only curated/learner-provided resources initially; do not rely on model-invented links.
7. **Plan generation model and cost ceiling:** select providers, per-plan token budget, retries, latency target, and fallback behavior.
8. **Admin access model:** define who can view support conversations, export learner data, grant comp access, and edit the offer catalog.
9. **Student versus creator accounts:** recommended shared identity with separate learner profile and product navigation; confirm whether a user may use both areas.
10. **Progress signals:** define whether a short self-check contributes to completion, and ensure it is not represented as formal certification.

## 18. Phase Two success measures

Measure whether learners can form a relevant plan, understand what to do next, and continue without unexpected cost or pressure. Initial product measures should include:

- First-subject creation completion and time to first roadmap.
- Percentage of plans accepted with no major edits versus edited (use edits as product learning, not failure).
- First-topic start and learner-return rate.
- Topic completion and plan-revision rates, segmented by subject and self-reported starting confidence.
- Learner-reported clarity/helpfulness and unresolved-question rate.
- AI cost and latency per generated plan and per learning session.
- Trial-to-paid conversion, cancellation, failed-payment recovery, refund, and support-contact rates.
- Privacy/access incidents, webhook reconciliation backlog, and data export/deletion completion time.

Do not optimize solely for messages sent or subscription conversion; learning clarity, learner control, and reliable billing are first-class success criteria.
