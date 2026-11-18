/**
 * @duepilot/core — public surface. Pure domain logic only: no Supabase, no Node/DOM APIs.
 * Phase 1 scope: money math, invoice state model, reminder schedule contract.
 * Validation schemas (zod) and CSV contracts are added in Phases 2–6 as features land —
 * nothing here is a placeholder: every export is implemented and tested.
 */
export * from "./money";
export * from "./invoice-state";
export * from "./schedule";
