# DuePilot — API Specification

DuePilot's data plane is **Supabase Postgres accessed through RLS** (not a hand-written CRUD REST API). This document specifies:

1. The **client data contract** (tables/views/RPC the SPA and desktop use),
2. The **Cloudflare Worker HTTP API** (privileged operations),
3. The **Supabase Edge Function API** (Stripe),
4. Shared conventions (auth, errors, idempotency, versioning).

Anything not listed here does not exist — clients must never invent endpoints.

---

## 0. Conventions

- **AuthN:** Supabase JWT (`Authorization: Bearer <access_token>`), HS256, verified by Postgres `auth.uid()` and by Worker/Edge Functions via JWKS-less shared secret verification against the Supabase project.
- **AuthZ:** RLS policies for data plane; role checks (`has_org_role`) for RPCs; Worker routes re-verify org membership server-side before any service-role write.
- **Content type:** `application/json; charset=utf-8`. Money = integer minor units + ISO currency code. Dates = `YYYY-MM-DD`; instants = RFC 3339 UTC.
- **Versioning:** Worker/Edge routes are prefixed `/v1`. Breaking change ⇒ `/v2` alongside. Data-plane contract evolves only additively within a major cycle.
- **Idempotency:** all state-changing Worker calls accept `Idempotency-Key: <uuid>` header; replays return the original result (stored 24 h).
- **Rate limits (Worker):** 60 req/min/user (cloudflare rate limiter); CSV import additionally 10 jobs/hour/org.
- **Error shape (everywhere):**
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "due_date must be >= issue_date",
             "details": [{ "field": "due_date", "rule": "gte:issue_date" }],
             "request_id": "req_01HZ…" } }
```
| HTTP | code examples |
|---|---|
| 400 | `VALIDATION_FAILED`, `MALFORMED_BODY` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403 | `NOT_A_MEMBER`, `INSUFFICIENT_ROLE`, `PLAN_LIMIT_REACHED`, `GDPR_BLOCKED` |
| 404 | `NOT_FOUND` (also used for cross-tenant probes — no existence leaks) |
| 409 | `CONFLICT`, `DUPLICATE_DELIVERY`, `STALE_VERSION` |
| 422 | `INVALID_TRANSITION`, `UNKNOWN_PLACEHOLDER` |
| 429 | `RATE_LIMITED` (+`Retry-After`) |
| 500/502 | `INTERNAL`, `UPSTREAM_EMAIL`, `UPSTREAM_STRIPE` (never leak upstream bodies) |

---

## 1. Data Plane (SPA/Desktop → Supabase, governed by RLS)

### 1.1 Tables available to clients (select/insert/update/delete per DATABASE_SCHEMA §9 matrix)
`organizations`, `profiles`, `org_members`, `clients`, `invoices`, `payments`, `reminder_schedules`, `email_templates`, `csv_jobs`, `subscriptions` (read-only), `reminder_instances` (read-only), `reminder_deliveries` (read-only).

Realtime channels: `postgres_changes` on `invoices`, `payments`, `reminder_deliveries`, `csv_jobs` (filtered by `org_id`).

### 1.2 SQL RPCs exposed to authenticated members (`security_invoker` or internal role gate)

| RPC | Args | Returns | Purpose |
|---|---|---|---|
| `create_organization` | name, timezone, currency, locale | org uuid | Bootstrap org + owner membership + default schedule/templates (single transaction) |
| `invoice_send` | invoice_id | invoice | draft→sent; materializes reminder instances; validates sender email configured |
| `invoice_void` | invoice_id, reason | invoice | →void; cancels pending reminders; admin+ |
| `invoice_reopen` | invoice_id, reason | invoice | paid/void→sent; admin+; audited |
| `record_payment` | invoice_id, amount_minor, currency, received_on, method, reference | payment | recompute trigger updates `payment_status` (partial payments ⇒ `partially_paid`) & cancels reminders only on full payment/void |
| `invoice_set_lifecycle` | invoice_id, to ('sent'\|'void'), reason? | invoice | lifecycle transitions only; `payment_status` and `is_overdue` are never client-writable (DATABASE_SCHEMA §3) |
| `reschedule_invoice_reminders` | invoice_id, schedule_id | int (new instance count) | cancel pending + re-materialize |
| `mark_overdue_invoices` | org_id (nullable=all caller's orgs) | int | refreshes derived `is_overdue` flag (orthogonal to payment status; paid invoices excluded) — invoked by cron & on read paths |
| `claim_due_reminders` | batch int | setof reminder_instances | **service_role only** — SKIP LOCKED claim incl. lease reclaim |
| `finish_reminder` | instance_id, outcome ('delivered','skipped','failed'), provider_message_id?, error? | void | **service_role only** — applies backoff/final states |
| `org_analytics` | from date, to date | kpi jsonb | dashboard payload (wraps v_org_kpis) |
| `gdpr_export_client` / `gdpr_anonymize_client` | client_id | file path / void | admin+, audited |

Client code calls these through typed wrappers in `apps/web/src/lib/db/*.ts` — no raw SQL strings in components.

---

## 2. Cloudflare Worker HTTP API (`https://api.<domain>/v1`)

The Worker holds `service_role` + Resend credentials. Every route: verify JWT → resolve membership → act. Requests that mutate tenant data pass the user JWT so RLS-equivalent checks still apply where possible; service-role is used only where RLS cannot (cross-org job claiming, delivery inserts).

### 2.1 `POST /v1/reminders/send-now`
Manual “send this reminder step now”.
```json
// request
{ "invoice_id": "uuid", "step_index": 2, "channel": "email" }
// 200
{ "instance_id": "uuid", "status": "delivered", "delivery_id": "uuid", "provider_message_id": "rm_…" }
```
Errors: `404 NOT_FOUND`, `422 INVALID_TRANSITION` (invoice paid/void/draft), `409 DUPLICATE_DELIVERY` (same idempotency key already delivered), `502 UPSTREAM_EMAIL` (Resend rejected; instance returned to retry queue).
Behavior: creates/reuses instance with deterministic idempotency key; renders template in effective language (user override → org locale → en); logs delivery. Fully replay-safe.

### 2.2 `POST /v1/reminders/test-email`
Send a template preview to the *authenticated user's own address* (never arbitrary addresses — anti-abuse). Body: `{ template_id, lang }`. Same render pipeline as production.

### 2.3 `POST /v1/jobs/run` (internal, `CRON_SECRET` bearer — not callable by users)
Alternative invocation of the scheduled tick for backfills/replays from an admin console. Body: `{ "now_override": iso?, "max_batches": int? }`.

### 2.4 `POST /v1/csv/import`
```
multipart/form-data: file (<= 5 MB, <= 20k rows), kind=clients_import|invoices_import, dry_run=bool
```
`202 { "job_id": "uuid" }` → progress via data-plane read of `csv_jobs`. Validation errors are per-row, non-fatal unless >50 % invalid (`400 VALIDATION_FAILED` with first 100 row errors when `dry_run=true`).

### 2.5 Scheduled (`scheduled()` cron `*/15 * * * *`)
No HTTP surface. Algorithm per ARCHITECTURE §3.3. Invariants: each instance processed at most once to terminal state; crash between Resend-accept and DB-write resolved by re-query of provider message id before retry (documented edge case, see SECURITY §7 deliverability note).

### 2.6 Health & metrics
`GET /v1/health` → `{ ok, version, db: bool, mailer_configured: bool }` (no secrets). `GET /v1/metrics` (admin token) → queue depth, oldest-pending age, failure rates — feeds uptime alerts.

---

## 3. Supabase Edge Functions

### 3.1 `POST /functions/v1/stripe-webhook`
Verifies `Stripe-Signature` (timestamp tolerance 300 s). Handles: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid|payment_failed`. Idempotent via `stripe_events` PK insert (duplicate event ⇒ 200 no-op). Updates `subscriptions` + `org_limits`; subscription lapse does **not** delete data (grace policy in SECURITY.md).

### 3.2 `POST /functions/v1/stripe-checkout`
Body: `{ org_id, plan, period: 'monthly'|'yearly' }`. Requires `has_org_role(org,'owner')`. Creates Stripe Checkout Session (mode subscription, client_reference_id=org_id) → `{ url }`.

### 3.3 `POST /functions/v1/stripe-portal`
Body: `{ org_id }` → billing-portal `{ url }`. Owner only.

---

## 4. Email Contract (outbound)

- From: org `from_name <from_email>` (verified domain), Reply-To: org `reply_to`.
- Templates per stage × lang (en/ro), variables whitelisted; amounts formatted with Intl in the org currency; due dates rendered in org timezone format `d MMMM yyyy` localized.
- Includes unsubscribe/legal footer per GDPR (link to org contact page placeholder until Phase 7 defines public pages — marked TODO, not faked).
- Bounces: Resend webhook (Phase 5) marks future sends `GDPR_BLOCKED`/hard-bounce suppressed; suppression list per `(org_id, email)`.

## 5. Client SDK layout (source of truth for “the API”)

```
packages/core/src/        # types, zod schemas, state machine, schedule math
apps/web/src/lib/db/      # supabase queries + rpc wrappers (typed from generated schema)
apps/web/src/lib/api/     # worker fetch client (typed from openapi.yaml below)
apps/worker/src/routes/   # one file per endpoint, zod-validated
supabase/functions/       # edge functions
```
An OpenAPI document (`docs/openapi.yaml`) is generated from Worker route definitions in CI and diffed on PRs — spec drift fails the build.
