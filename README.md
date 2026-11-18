# DuePilot

**Stop chasing payments. Start getting paid.**

DuePilot is a commercial-grade invoice payment reminder platform for freelancers, agencies and small businesses. It tracks unpaid invoices, monitors payment deadlines and automates professional email reminders — as a web app, a desktop application and a responsive PWA.

---

## Feature Overview

| Area | Capabilities |
|---|---|
| Organizations | Multi-tenant workspaces, roles (owner / admin / member), per-org time zone, currency and language |
| Clients | Client directory with billing contacts, VAT/registration IDs, notes |
| Invoices | Full lifecycle: draft → sent → partially paid → paid → overdue → void |
| Payments | Partial and complete payment recording, allocation to invoices |
| Reminders | Custom before/after-due schedules, duplicate suppression, retries, delivery logs, stop-on-paid |
| Email | Editable templates, per-organization branding, EN/RO rendering via Resend |
| Data | CSV import/export (clients & invoices), dashboard analytics |
| Billing | Stripe subscriptions, plan limits enforced server-side |
| Platform | Dark-first UI with light theme, i18n (EN default, RO), locale-aware dates/numbers |

## Clients (Platforms)

- **Web** — React SPA served statically, installable as a PWA (also the Android strategy).
- **Desktop** — Electron shell wrapping the same React build (macOS / Windows / Linux).
- **Android** — Responsive PWA now; Capacitor packaging scaffolded for later. Electron is *not* compiled for Android.

## Technology Stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript (strict), Vite, Tailwind CSS, shadcn/ui, Lucide icons, React Router |
| Desktop | Electron + electron-builder |
| Backend / Data | Supabase: PostgreSQL, Auth (JWT), Storage, Row Level Security |
| Scheduled jobs | Cloudflare Worker with Cron Triggers (reminder engine tick) |
| Transactional email | Resend (API key lives **only** in the Worker secret store) |
| Payments / subscriptions | Stripe (Checkout + Billing; webhooks handled by a Supabase Edge Function) |
| i18n | i18next + react-i18next (EN, RO) |
| Testing | Vitest (unit/integration logic), Playwright (E2E) |

## Architecture at a Glance

```
 React SPA (Vite) ──► Supabase (Postgres + RLS, Auth, Storage)
      │    ▲
      │    └── realtime updates (invoice/payment changes)
      │
      ├──► Cloudflare Worker (cron */15m) ──► Reminder Engine ──► Resend
      │            │                              │
      │            └── service-role DB access     └── writes reminder_deliveries log
      │
      └──► Supabase Edge Function ──► Stripe webhooks / checkout sessions

 Electron wraps the built SPA (no secrets in renderer).
 PWA manifest + service worker make the same SPA installable on Android/desktop.
```

Details: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) · [API_SPECIFICATION.md](./API_SPECIFICATION.md) · [SECURITY.md](./SECURITY.md) · [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) · [TESTING.md](./TESTING.md) · [CHANGELOG.md](./CHANGELOG.md)

## Repository Layout (target)

```
duepilot/
├── apps/
│   ├── web/            # React + Vite SPA (also the PWA)
│   ├── desktop/        # Electron wrapper around apps/web build
│   └── worker/         # Cloudflare Worker: cron reminder engine + email dispatch
├── packages/
│   ├── core/           # Domain logic: status machine, schedule math, validation (pure TS)
│   ├── ui/             # Shared shadcn-based components + design tokens
│   └── i18n/           # EN/RO translation catalogs
├── supabase/
│   ├── migrations/     # Versioned SQL (schema + RLS policies)
│   └── functions/      # Edge Functions (stripe-webhook, etc.)
├── e2e/                # Playwright suites
├── docs/               # Extra diagrams/runbooks
└── *.md                # This documentation set
```

`packages/core` is dependency-free TypeScript so it can be shared by web, worker and tests without bundling issues.

## Getting Started (development)

Prerequisites: Node ≥ 20, pnpm ≥ 9, Docker (for local Supabase), a Supabase project, Resend and Stripe test accounts.

```bash
pnpm install
cp .env.example apps/web/.env.local       # fill in Supabase URL/anon key
pnpm --filter @duepilot/core test          # run domain logic tests
pnpm --filter @duepilot/web dev            # start the SPA (http://localhost:5173)
supabase start && supabase db reset        # local Postgres + migrations + seed
```

The anon key is safe for the browser; `service_role` and Resend/Stripe secret keys must only ever live in the Cloudflare Worker secrets and Supabase Edge Function environment (see [SECURITY.md](./SECURITY.md)).

## Status

Phase 0 (architecture, documentation, risk analysis) is complete. Implementation proceeds phase-by-phase per [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md). No feature should be considered shipped until its tests pass — see [TESTING.md](./TESTING.md).

## License

Proprietary — All rights reserved.
