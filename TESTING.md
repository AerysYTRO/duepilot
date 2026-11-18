# DuePilot — Testing Strategy

Two layers, one gate: **Vitest** for logic/integration against local Supabase, **Playwright** for end-to-end user journeys. CI runs everything on every PR; main branch must be green to deploy.

## 1. Pyramid

| Layer | Tool | Scope | Speed target |
|---|---|---|---|
| Unit | Vitest (`packages/core`, component tests via Testing Library) | Money math, state machine, schedule expansion (DST!), validation schemas, formatters, idempotency key derivation | < 30 s total |
| DB integration | Vitest + `supabase start` (local Postgres) | Migrations apply, triggers/RPCs, **RLS negative tests**, plan-limit enforcement | < 3 min |
| Worker tests | Vitest with `@cloudflare/vitest-pool-workers` (miniflare) | Cron tick algorithm with fake Resend/DB doubles; retry/backoff; claim lease behavior | < 2 min |
| Component/E2E | Playwright (chromium + webkit; devices: Pixel 7, iPad) | Auth→org→client→invoice→payment→reminder history golden paths; theme/i18n toggles; CSV round trip | smoke < 4 min, full < 15 min |
| Desktop smoke | Playwright `_electron_` | App boots, login persists, navigation works against staging API | nightly |

## 2. Mandatory Business-Logic Suites (Definition of Done per phase)

**Money (`core/money`)**
- Integer minor-unit arithmetic; JPY (0-dec) vs EUR/USD/RON (2-dec); rounding half-up policy fixed and tested; overflow guards; currency mismatch rejected.

**Invoice state machine (`core/invoice-status`)**
- Every legal transition allowed; every illegal transition rejected (table-driven exhaustive test); partial payment recomputation incl. deleting a payment reverts status; overdue derived at org-timezone midnight boundary (test at UTC+2/+3 EEST/EET switch).

**Reminder schedules (`core/schedule`)**
- Expansion before/after due dates; anchor = due date in org tz at 09:00 local; DST spring-forward/fall-back days produce exactly one instance per step; max-steps/range validation; re-materialization cancels stale pendings.

**Idempotency & retries (`worker` + DB)**
- Double claim returns disjoint sets (SKIP LOCKED simulation); crash after Resend-accept before finish ⇒ replay does not re-send (provider message lookup / unique key); backoff sequence 15m/1h/4h/12h then `failed`; stop-on-paid verified both at materialization and at dispatch time.

**Validation & CSV (`core/csv`, worker routes)**
- Fuzz-ish malformed rows (bad dates, huge cells, formula prefixes, wrong currency codes) produce structured row errors, never exceptions that kill the job; export→import round-trip equality.

## 3. Security Tests (CI-blocking)

- **Cross-tenant matrix:** second authenticated user from another org attempts select/insert/update/delete on *every* tenant table and calls *every* RPC ⇒ expect zero rows affected / permission errors. Generated from a table registry so new tables are covered automatically.
- Privilege escalation: member attempts admin-only RPCs (`invoice_reopen`, template edit, member management).
- Template injection: `<script>`, `onerror=`, unknown placeholders, link-host spoofing ⇒ sanitized/rejected.
- Secret scan: gitleaks + client-bundle grep for `service_role`/`sk_live_`/`re_live_`.
- Stripe webhook: forged signature rejected; replayed event no-op.

## 4. Flakiness & Data Hygiene

- E2E uses dedicated seed fixtures per run (`e2e--<runid>` org namespace), cleaned by global teardown; never shared mutable state between specs.
- Time is injected (`now()` override seams in core/worker) — no wall-clock-dependent assertions except explicit clock tests.
- Retries: unit/db 0 retries; Playwright max 1 with flake-report gate (>2 flakes/week blocks merge until fixed).

## 5. Coverage Policy

- `packages/core`: ≥ 95 % lines/branches (hard gate — it's the correctness heart).
- Worker engine modules: ≥ 85 %.
- UI: coverage tracked, not gated; critical paths gated by E2E instead.

## 6. Commands (Phase 1 onward)

```bash
pnpm -r test              # all vitest projects
pnpm --filter @duepilot/core test:watch
pnpm db:test              # supabase local reset + integration suite
pnpm e2e                  # playwright chromium
pnpm e2e:mobile           # pixel-7/webkit project
pnpm test:rls             # cross-tenant security matrix
```

## 7. Manual Test Charters (per release)

Deliverability spot-check (Gmail/Outlook/Yahoo inbox placement EN+RO), Android Chrome PWA install + offline shell, Electron macOS/Windows signed builds, GDPR deletion drill on staging, restore-from-backup drill quarterly.
