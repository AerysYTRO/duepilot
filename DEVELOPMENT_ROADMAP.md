# DuePilot — Development Roadmap

Phase gating rule: a phase is **done** only when its acceptance criteria pass in CI (unit + integration + relevant E2E) and docs are updated. Nothing is marked complete on implementation alone.

---

## Phase 0 — Architecture & Documentation ✅ (this commit)
Repo inspection, system design, DB schema, API contract, security model, test strategy, risk register, documentation set.
**Exit:** docs reviewed; approval requested before Phase 1.

## Phase 1 — Foundation & Tooling (est. 3–4 d)
Monorepo scaffold (pnpm workspaces): `apps/web`, `apps/worker`, `packages/core|ui|i18n`; Vite + React + TS strict; Tailwind with DuePilot tokens; shadcn/ui init; ESLint/Prettier; Vitest wired; CI pipeline (lint, typecheck, test, build, secret-scan); `.env.example`; Supabase local stack (`supabase start`), seed script with demo org.
**Accept:** empty-but-themed app shell renders dark/light; CI green on PR; `core` package has passing smoke tests.

## Phase 2 — Auth, Organizations & Members (est. 5–7 d)
Migrations: profiles, organizations, org_members + RLS + `create_organization`. Signup/login/logout, email confirmation flow, session persistence per platform (web/Electron/PWA), org switcher, member invite/join, roles enforced server-side, theme+locale per user.
**Accept:** two-user/two-org RLS negative tests pass; last-owner invariant tested; auth E2E (Playwright) green.

## Phase 3 — Clients & Invoices & Payments (est. 7–10 d)
CRUD UIs + migrations for clients, invoices, payments, invoice numbering trigger, status state machine (core + DB guard), partial payments, overdue derivation, filters/sorting/pagination, invoice detail with timeline.
**Accept:** property-based tests for money math & state machine; payment recompute triggers tested incl. delete-of-payment rollback; cross-org probes fail closed.

## Phase 4 — Reminder Engine v1 (est. 7–10 d)
Schedules CRUD (validation core+SQL), materialization triggers, `reminder_instances` lifecycle, Worker cron tick, claim RPC (SKIP LOCKED + lease), Resend send, deliveries log, stop-on-paid, retries/backoff, manual send-now, reminder history UI. *(Separate concern, scheduled here for capacity reasons:* **TOTP 2FA — Time-based One-Time Password multi-factor authentication for owners/admins — is an Authentication/Security feature per SECURITY.md §2, not part of the reminder engine.***)**
**Accept:** idempotency chaos test (double-claim, crash-replay ⇒ exactly one delivery); DST boundary schedule tests; paid-mid-cycle cancels pending instances; history reflects every attempt.

## Phase 5 — Templates, i18n & Email Polish (est. 5 d)
Template editor (sanitized HTML, placeholder validation, version bump), EN/RO catalogs across UI + default templates, per-org locale/timezone/currency settings, test-email preview to self, bounce suppression list, deliverability hardening (SPF/DKIM/DMARC verified).
**Accept:** rendering golden-file tests EN/RO; unknown-placeholder rejected; preview matches production renderer byte-for-byte (shared code).

## Phase 6 — CSV Import/Export & Analytics Dashboard (est. 6–8 d)
csv_jobs pipeline (upload→validate→dry-run→commit, row-error report), exports (clients/invoices/payments), formula-injection neutralization; dashboard KPIs via `org_analytics` + charts (Recharts), aging buckets (1–30/31–60/61–90/90+), collection trend.
**Accept:** round-trip export→import equivalence test; 20k-row import under time budget; KPI SQL tested against seeded fixture data.

## Phase 7 — Stripe Billing & Plan Limits (est. 5–7 d)
Plans (free/starter/pro/agency), checkout + portal Edge Functions, webhook ledger, limits enforced by triggers (clients, invoices/mo, schedules, seats, email volume), upgrade/downgrade UX, grace policy.
**Accept:** webhook replay-idempotency test; limit-exceeded inserts rejected at DB level with Stripe test-clock subscription lifecycle E2E.

## Phase 8 — Desktop & PWA Hardening + GDPR Ops (est. 5–7 d)
Electron packaging (signed/notarized, auto-update), deep links, PWA install/offline-shell audit, Capacitor readiness spike doc, GDPR export/anonymize/deletion flows + retention crons, runbooks, load test of cron at 10× volume, pen-test remediation buffer.
**Accept:** desktop smoke E2E (Playwright _electron_), Lighthouse PWA pass, GDPR erasure verified absent from all tables/storage.

## Phase 9 — Beta & GA
Private beta (10 orgs), feedback triage, pricing page, landing site, observability dashboards/alerts, backup/restore drill, legal docs sign-off (SG-3), launch checklist.

---

## Sequencing Rationale
Core value = reliable reminders ⇒ engine (P4) comes before polish (P5) and billing (P7); data integrity (P3) must precede the engine because the engine consumes invoice state. Desktop/PWA hardening is late because the shared web app already delivers those platforms functionally.

## Risk Register (living)

| ID | Risk | Impact | Likelihood | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-1 | Supabase RLS misconfiguration leaks tenant data | Critical | Medium | Policy matrix review checklist + automated cross-tenant test suite gating every phase | Arch | Design done, tests in P2 |
| R-2 | Reminder double-send / spam reputation damage | High | Medium | Idempotency keys, leases, chaos test P4, rate caps P7 | Backend | Designed |
| R-3 | Email deliverability (spam folder) undermines product value | High | Medium | Verified domain, warm-up, bounces, monitoring; launch gate | Ops | Open |
| R-4 | Timezone/DST scheduling bugs across locales | Medium | High | UTC storage, IANA tz, DST unit tests in core, golden files | Core | Designed |
| R-5 | Electron↔web drift (two codebases) | Medium | Low | Single SPA build artifact; Electron is dumb shell; CI builds once | FE | Enforced by layout |
| R-6 | Cloudflare Worker CPU limit for large batches | Medium | Low | Batched claims, pagination, subrequests; metrics alert on queue age | Backend | Watch P4 |
| R-7 | Resend/Supabase vendor lock-in | Low | Low | Provider interface in worker (`Mailer` port); deliveries store provider name | Arch | Accepted |
| R-8 | Scope creep delays commercial viability | High | High | Phase gates; anything not in spec is backlog; AD table for decisions | PM/Arch | Active |
| R-9 | Stripe webhook loss/reorder desyncs plan state | Medium | Low | Event ledger + nightly reconciliation job (P7) | Backend | Designed |
| R-10 | Android expectations vs PWA reality | Low | Medium | Communicate PWA-first; Capacitor spike documented in P8 | PM | Open |

## Definition of Done (every feature)
TypeScript strict-clean · validated server-side · loading/error/empty states · i18n keys EN+RO · unit tests for logic + integration test for data path · security note reviewed · docs updated · CHANGELOG entry.
