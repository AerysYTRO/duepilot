# DuePilot — Security Design

Scope: web SPA, PWA (Android), Electron desktop, Cloudflare Worker, Supabase (Postgres/Auth/Storage), Stripe, Resend.
Principle: **the client is hostile by default.** Authorization is enforced where the client cannot reach: Postgres RLS, Edge Functions, and the Worker.

---

## 1. Threat Model (summary)

| Threat | Primary control |
|---|---|
| Tenant data theft via manipulated ids | RLS on every tenant table; policies via membership function, not JWT claims |
| Privilege escalation (member→admin) | Role checks inside RPCs/triggers; UI gating is cosmetic only |
| Stolen API keys / secrets in bundle | Secrets exist only in Worker/Edge env; CI secret-scan blocks builds |
| Reminder spam / duplicate emails | Idempotency keys + claim lease + stop-on-paid re-check at send time |
| Template injection / XSS via stored HTML | Whitelisted placeholders, server-side sanitization, strict CSP |
| CSV import abuse (formula injection, bombs) | Size/row caps, type coercion, cell escaping, dry-run mode |
| Account takeover | Supabase Auth (bcrypt/argon2), optional TOTP (Time-based One-Time Password) MFA (Phase 4 — auth/security, see §2; not a reminder-engine feature), session rotation, device list |
| Payment fraud / webhook forgery | Stripe signature verification + event id ledger |
| Data exfiltration via export | Exports audited; Storage URLs signed, short-lived |

## 2. Authentication & Sessions

- Supabase Auth: email+password now; Google OAuth later (same phase as billing rollout). Password policy delegated to Supabase (min 8, breached-password protection enabled); we add zxcvbn strength meter client-side.
- PKCE flow for browser; refresh-token rotation on. Access tokens ≤ 1 h.
- **Electron:** tokens kept in `safeStorage`-encrypted file, never localStorage; renderer obtains them only through typed IPC from main process which proxies nothing but storage (network still goes direct with anon key + token).
- **PWA/Android:** HTTPS-only origin, tokens in memory + encrypted IndexedDB fallback; no service-worker caching of authenticated responses.
- Session revocation: sign-out everywhere via Supabase admin API (Worker route, owner/admin self-service).
- **MFA / TOTP clarification:** TOTP = *Time-based One-Time Password*, the second factor in our optional/plan-gated MFA flow. It belongs to Authentication & Security (this section), and is scheduled for delivery during the Phase 4 time window purely for capacity planning — it is **not** part of the reminder engine. Owners/admins on paid plans will be required to enroll; enforcement lands with the billing phase.

## 3. Authorization (server-enforced)

- Every tenant table: `ENABLE ROW LEVEL SECURITY` + deny-by-default (no policy ⇒ no access). Policies call `is_org_member(org_id)` / `has_org_role(org_id,'admin')`. `TO authenticated` explicitly; `service_role` bypasses RLS and exists **only** in Worker/Edge secrets.
- RPCs marked `SECURITY DEFINER` are individually reviewed, `search_path` pinned, and each begins with an explicit role check — no exceptions.
- Cross-tenant probing returns `404 NOT_FOUND` semantics (RLS filters rows out entirely).
- Plan limits enforced by DB triggers (`PLAN_LIMIT_REACHED`) so a compromised client cannot bypass billing tiers.
- Automated test gate: RLS test suite (TESTING.md §4) runs a second-org user against every table/RPC; any leak fails CI.

## 4. Secrets Management

| Secret | Location | Rotation |
|---|---|---|
| Supabase `anon` key | build-time public env (`VITE_…`) | project reissue |
| Supabase `service_role` | CF Worker secret; Supabase Edge env | quarterly; incident-triggered |
| Resend API key | CF Worker secret only | quarterly |
| Stripe `sk_live`, webhook signing secret | Edge Function env (webhook) + Worker if needed | on staff change/incidents |
| `CRON_SECRET` (jobs/run) | Worker secret | per deploy cycle |
| JWT signing key | Supabase-managed | Supabase dashboard procedure documented |

CI runs `gitleaks` + a bundling guard that fails the build if any string matching `eyJ…service` patterns or `sk_live_`/`re_live_` appears in client artifacts. `.env.example` documents every variable with safety annotation (`PUBLIC` vs `SECRET`).

## 5. Transport & Platform Hardening

- TLS 1.2+ everywhere; HSTS preload on app/api domains; CSP on web/PWA: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co https://api.<domain>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (report-to endpoint monitored).
- Electron: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, navigation blocked to external origins (shell.openExternal allowlist https only), auto-updater over signed artifacts, remote module disabled.
- Storage buckets: `org-logos` (public read per path — logos only), `csv-imports`/`exports` (private; signed URLs TTL ≤ 10 min; lifecycle delete ≤ 7 days).

## 6. Input Validation & Content Safety

- All writes validated twice: zod schemas from `packages/core` on the client (UX) and SQL CHECKs/triggers or Worker-side zod on the server (truth). Server validation is authoritative.
- Email templates: admins write HTML → sanitized server-side (DOMPurify-equivalent allowlist: p, div, span, strong, em, a[href^=http(s)], ul/ol/li, table/tr/td, br; styles limited) before save; rendering injects only whitelisted variables, HTML-escaped; unknown placeholder ⇒ `422 UNKNOWN_PLACEHOLDER`.
- CSV: header whitelist mapping, per-cell length caps, numeric/date parsing locale-explicit, leading `= + - @` cells prefixed to neutralize spreadsheet formula injection, reject files >5 MB / >20k rows.
- Search/filter inputs parameterized via PostgREST — no string SQL concatenation anywhere (lint-enforced).

## 7. Reminder Engine Abuse & Deliverability

- Rate limiting: per-user 60 req/min; per-org outbound email budget (plan-based, e.g. free = 50/mo) checked transactionally before send ⇒ `PLAN_LIMIT_REACHED`.
- Duplicate suppression: unique `idempotency_key`, claim lease prevents parallel double-send, stop-on-paid re-check immediately before dispatch, manual sends share the same queue.
- Anti-open-redirect in template links: only org-configured domain + whitelisted invoice paths.
- Deliverability (commercial-critical): verified sending domain with SPF/DKIM/DMARC, plain-text alternatives, List-Unsubscribe header, hard-bounce suppression list, warm-up schedule for new domains. Failure here silently destroys the product's core value — tracked as launch-gate risk R-3.

## 8. GDPR & Data Governance

- Legal basis: processing client contacts as data processor for the org (DPA template required before EU sales — roadmap item, legal task, not code).
- Data map: personal data in profiles, clients, deliveries(to_email), csv files. Documented in DATABASE_SCHEMA §10.
- Rights tooling: client export (JSON/CSV) and anonymization RPCs (admin+, audited); account deletion purges profile and detaches memberships; org deletion cascades with 30-day soft window.
- Retention jobs (Worker cron, daily): deliveries >24 mo truncated, orphan Storage objects swept, audit log archived >5 y.
- Locale-aware consent text EN/RO in signup; cookie banner only for non-essential analytics (Plausible, self-hosted — decision AD-5 open).

## 9. Payments (PCI scope)

- Card data never touches our systems: Stripe Checkout/Elements hosted fields only. We store only Stripe ids. Webhooks verified by signature; replay-protected by `stripe_events` PK. Downgrade/expiry keeps data readable + exportable (grace 30 d), then read-only lock — never silent deletion of customer accounting data.

## 10. Audit & Incident Response

- `audit_log` covers authz-relevant mutations (memberships, roles, plan, reopen/void, exports, GDPR ops, template edits).
- Structured logs shipped to central drain; PII redaction filter on log sinks.
- Runbook (docs/runbooks/): rotate secrets, revoke sessions fleet-wide, disable cron, quarantine org. Created in Phase 8 hardening; until then flagged incomplete.

## 11. Known Gaps at Phase 0 (honest register)

| ID | Gap | Mitigation/Plan |
|---|---|---|
| SG-1 | No MFA yet | Phase 4 window (TOTP MFA — auth/security, §2), mandatory for admins on paid plans |
| SG-2 | Email deliverability unproven | Domain warm-up + monitoring gates Phase 5 exit |
| SG-3 | DPA/terms legal docs absent | Before first commercial sale (Phase 8) |
| SG-4 | Pen test not performed | Third-party test scheduled pre-GA |
