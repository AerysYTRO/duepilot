# DuePilot — Architecture

Status: **Phase 0 approved draft** · Owner: Lead Architect · Last updated: 2026-11-19

---

## 1. Goals & Constraints

- One product, three delivery targets: **Web SPA**, **Electron desktop**, **Android via PWA** (Capacitor-ready later).
- Multi-tenant SaaS with **database-enforced** tenant isolation (Supabase RLS).
- Automated email reminders that are **idempotent**, retry-safe, timezone-aware and stop on payment.
- No service secrets in any client. All privileged operations run server-side (Worker / Edge Functions) or are authorized by RLS.
- TypeScript strict everywhere; pure domain logic isolated for testability.

## 2. System Context

```
                                   ┌────────────────────┐
   Browser (Web/PWA) ────────────► │                    │
   Electron renderer ────────────► │  Supabase          │◄── Auth (JWT, email/OAuth)
   (future Capacitor) ───────────► │  Postgres + RLS    │◄── Storage (logos, CSV files)
                                   └─────────▲──────────┘
                                             │ service_role (server only)
   Cloudflare Worker                          │
   ├─ Cron trigger (*/15 min) ────────────────┤  claim due reminder instances (FOR UPDATE SKIP LOCKED)
   ├─ Reminder engine tick                    ├──► Resend API (secret in Worker env)
   └─ HTTP endpoint (manual "send now")       │
                                             │
   Supabase Edge Function                    │
   └─ stripe-webhook (verify signature) ─────┴──► subscriptions/plan limits
   Stripe Checkout / Billing portal ◄── created via Edge Function (checkout-sessions)
```

The SPA talks **directly to Supabase Postgres through RLS** for CRUD (this is the intended Supabase pattern: the anon key plus a user JWT, with row-level policies as the authorization boundary). Anything privileged (email sending, cross-tenant job claiming, Stripe secret handling) goes through the Worker or Edge Functions.

## 3. Component Responsibilities

### 3.1 `apps/web` — React SPA (also PWA & Electron content)
- Vite + React 18 + TS strict. Tailwind + shadcn/ui + Lucide. React Router v6 with route-level code splitting.
- State: server state via TanStack Query (cache, retries, invalidation); minimal client state (Zustand for org/theme/locale).
- Feature modules: `auth`, `org`, `clients`, `invoices`, `payments`, `reminders`, `templates`, `import-export`, `analytics`, `billing`, `settings`.
- Layout shell: dark-first theme tokens (CSS variables), light theme toggle persisted per-user; responsive down to 360 px (Android PWA target).
- PWA: `vite-plugin-pwa` — manifest, install prompt, static-shell caching (API responses are never cache-first).
- **Rule:** UI components never contain business rules; they call hooks → services → `packages/core` + Supabase client.

### 3.2 `apps/desktop` — Electron
- Thin main process: window management, secure deep links (`duepilot://`), auto-update (electron-updater), credential storage via OS safeStorage for refresh tokens if needed.
- Loads the exact `apps/web` production build (`file://` in prod, `http://localhost:5173` in dev). Renderer has `contextIsolation: true`, `nodeIntegration: false`, sandbox enabled. IPC surface is minimal and typed.
- No Electron code in Android path. Capacitor readiness = the web app already meets PWA + touch + safe-area requirements; a `apps/mobile-capacitor` wrapper will be added in a later phase without touching shared code.

### 3.3 `apps/worker` — Cloudflare Worker (Reminder Engine driver)
- `scheduled()` cron every 15 minutes:
  1. Claim due `reminder_instances` (`status='pending' AND scheduled_for <= now()`) using an atomic RPC that does `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING` — guarantees one worker tick owns each instance (idempotency layer 1).
  2. For each claimed instance: re-check invoice status in DB; if paid/void → mark `skipped` (stop-on-paid rule enforced at send time, not just schedule time).
  3. Render email from template (org language + branding), send via Resend, write `reminder_deliveries` row (attempt count, provider id, error). On failure: `pending` again with `attempts+1` until max attempts → `failed` (retry policy §DATABASE_SCHEMA §reminder_instances).
- Also exposes `POST /send-now` (user-JWT verified against Supabase Auth) for manual reminder sends.
- Secrets (Resend key, service_role key, Stripe keys) live only in `wrangler secret put`. The Worker validates the caller's JWT before performing service-role writes for user-triggered actions.

### 3.4 `supabase/`
- `migrations/`: every schema change is a versioned SQL migration; RLS policies ship in the same migration as their table. Never edit applied migrations.
- `functions/stripe-webhook`: verifies `Stripe-Signature`, updates `organizations.plan/subscription status`, records events idempotently (unique Stripe event id).
- `functions/checkout-sessions`: creates Stripe Checkout / billing-portal sessions for the org after checking the caller's org role via RLS-scoped query.
- Triggers (SQL): invoice status recomputation from payments; overdue flagging is derived, not stored twice (see DATABASE_SCHEMA §generated columns).

### 3.5 `packages/core` — pure domain logic (no runtime deps)
- Money arithmetic in **integer minor units** (avoid float bugs), currency metadata.
- Invoice status state machine (allowed transitions, guards).
- Reminder schedule math: expand a `reminder_schedule` into concrete UTC instants given a due date + IANA org timezone (DST-safe via temporal-math helpers; tested against DST boundaries).
- Idempotency key generation/validation, CSV schema validation (zod schemas shared client/server), date/number locale formatting contracts.
- This package is the primary Vitest target.

### 3.6 `packages/ui`, `packages/i18n`
- `ui`: shadcn-based primitives, DuePilot design tokens (palette below), invoice status badges, empty/loading/error states.
- `i18n`: EN + RO catalogs namespaced by feature; interpolation for emails rendered server-side by the Worker from the same catalogs where possible.

## 4. Design Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-midnight` | `#0B1424` | App background (dark) |
| `--bg-surface` | `#111F33` | Cards, panels, nav |
| `--accent-teal` | `#20C7B1` | Primary actions, focus rings |
| `--accent-mint` | `#A3F0D5` | Secondary highlights, charts |
| `--text-primary` | `#F4F7FB` | Body text (dark theme) |
| `--text-muted` | `#8796AA` | Captions, placeholders |
| `--success` | `#35C98A` | Paid, delivered |
| `--alert` | `#F07878` | Overdue, failed |

Light theme remaps surfaces to Cloud White family while keeping accent semantics. Implemented as CSS variables consumed by Tailwind (`tailwind.config.ts` maps to `hsl(var(--…))` convention of shadcn). Typography: Inter (self-hosted, `font-display: swap`).

## 5. Data Flow Examples

**Create invoice (client-permitted):** SPA validates with `core` zod schema → inserts via Supabase client → RLS ensures `org_id` membership → trigger recomputes nothing (draft) → TanStack Query invalidates list.

**Automatic reminder:** cron claims instance → checks invoice unpaid → renders RO/EN email → Resend accept → delivery logged → SPA shows it in Reminder History via realtime subscription on `reminder_deliveries`.

**Payment received:** user records payment → trigger sets `paid_amount`, status becomes `partially_paid`/`paid` → pending future instances for that invoice are cancelled by the same trigger (stop-on-paid, layer 2).

## 6. Cross-Cutting Concerns

- **Time zones:** all timestamps stored `timestamptz` (UTC). Org timezone is an IANA string; conversion happens at display (Intl) and at scheduling (core math). Cron evaluates in UTC.
- **Money:** integer minor units + ISO 4217 currency code; rounding policy documented in `core/money`.
- **Errors/loading:** every async screen has skeleton, error-with-retry and empty states; failed mutations always surface a toast + retain form input. No silent catches (lint rule `no-floating-promises`, banned empty catch blocks).
- **Observability:** Worker logs structured JSON (instance ids, durations); `reminder_deliveries` doubles as an audit trail; Supabase log drains in production.
- **Versioning/migrations:** additive migrations preferred; destructive changes require two-phase deploy documented in DEVELOPMENT_ROADMAP.

## 7. Deployment Topology

- Web/PWA: static hosting (Cloudflare Pages). Preview deploys per PR.
- Worker: `wrangler deploy`, cron `*/15 * * * *`.
- Supabase: managed project per environment (dev/staging/prod); migrations via CI (`supabase db push`).
- Electron: tagged releases build artifacts via CI (electron-builder, signed/notarized).
- Environments gate Stripe test/live keys and separate Resend domains (production domain verified with SPF/DKIM/DMARC — deliverability is a launch-critical risk, see SECURITY.md §7).

## 8. Open Architectural Decisions (tracked)

| ID | Question | Current lean |
|---|---|---|
| AD-1 | Realtime vs polling for history lists | Realtime channels on deliveries/payments; fallback polling every 30 s |
| AD-2 | Email rendering location | Worker renders HTML from stored template + i18n catalog (single source of truth) |
| AD-3 | Offline support depth (desktop) | Read-only cached dashboard in Phase 6+; out of MVP scope |
| AD-4 | Capacitor timing | After PWA metrics prove mobile retention need (Phase 8) |
