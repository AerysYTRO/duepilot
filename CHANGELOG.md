# Changelog

All notable changes to DuePilot. Format follows Keep a Changelog; versions follow SemVer.
Feature completeness is tracked per phase in DEVELOPMENT_ROADMAP.md — entries below reflect **verified** work only.

## [Unreleased]

### Added — Phase 0 (Architecture & Documentation)
- Initial documentation set: `README.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_SPECIFICATION.md`, `SECURITY.md`, `DEVELOPMENT_ROADMAP.md`, `TESTING.md`, `CHANGELOG.md`.
- Approved architecture: monorepo layout (`apps/web|desktop|worker`, `packages/core|ui|i18n`, `supabase/`), dark-first design tokens, platform strategy (Web SPA = PWA = Electron content; Android via PWA, Capacitor-ready).
- Database design: multi-tenant schema with RLS policy matrix, invoice state machine, materialized reminder job queue with idempotency keys, leases and retry/backoff, delivery log, Stripe billing tables, CSV jobs, audit log, GDPR retention notes.
- API contract: data-plane RPC list, Worker HTTP v1 endpoints, Edge Function endpoints, error taxonomy, idempotency-key convention.
- Security design: threat model, secrets inventory, CSP/Electron hardening, template sanitization, deliverability controls, known-gap register (SG-1…SG-4).
- Testing strategy: Vitest + Playwright pyramid, mandatory business-logic suites, CI-blocking cross-tenant RLS matrix, coverage gates.
- Risk register R-1…R-10 and phased roadmap with acceptance criteria.

### Known status
- No application code exists yet by design — Phase 1 (tooling scaffold) starts after Phase 0 approval.
