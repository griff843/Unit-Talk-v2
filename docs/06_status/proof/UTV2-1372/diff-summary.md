# UTV2-1372 Diff Summary

Merge SHA: `18d637cbaa01ad6ce571d1c25d6326579591466f` (PR #1162, squash-merged 2026-07-07T03:17:23Z)

## Summary

Read-only Supabase egress and query-diet audit (docs-only lane, no source edits). The Codex execution pass produced only proof/lane bookkeeping without the actual audit deliverable; the audit itself (`docs/06_status/audits/supabase-egress-query-diet-audit.md`) was completed directly (static code search + Performance Advisor cross-reference) before this lane closed.

## Headline finding

90 `select('*')` call sites across `packages/db/src` and the app runtimes, concentrated in `packages/db/src/runtime-repositories.ts` (178 total `.select(` calls, only 41 pair with `.limit(`, only 4 use `.range()`). 46 test files execute live Supabase queries on every `pnpm verify` run (every PR/push), a recurring CI-driven cost independent of production traffic. Cross-references UTV2-1369's storage findings (`provider_offers_legacy_quarantine`, `provider_offer_history`) as the highest-value targets for a follow-up per-call-site query audit.

## Files Changed

- `docs/06_status/audits/supabase-egress-query-diet-audit.md` (new) — the audit deliverable.
- `docs/06_status/proof/UTV2-1372/diff-summary.md` — this file.
- `docs/06_status/proof/UTV2-1372/verification.md` — command evidence and verification notes.
- `.ops/sync/UTV2-1372.yml`, `docs/06_status/lanes/UTV2-1372.json` — lane bookkeeping (orchestration-generated).

No runtime code, schema, migrations, contracts, domain logic, repositories, API services, worker code, or generated database types were changed by this lane — read-only audit only, per issue acceptance criteria.

## Scope Notes

No query rewrite or optimization implementation performed in this lane; follow-up lanes are listed in the audit doc.

## Verification

See `docs/06_status/proof/UTV2-1372/verification.md` for the command log summary. The final full gate was:

- `pnpm verify` — PASS on rerun.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS before proof-file addition; rerun after proof-file addition is recorded in `verification.md`.
