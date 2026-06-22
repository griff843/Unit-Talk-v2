# UTV2-1292 — Diff Summary

**Lane:** UTV2-1292 — Implement live-DB verify isolation and infra-unavailable status
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude
Implements the approved UTV2-1291 proposal. CI/test-harness only — no runtime/data/migration behavior change.

## Files changed

| File | Change | Purpose |
|---|---|---|
| `package.json` | modified | Split scripts: `test:t1-proof:local` / `:live`, root `test` now local-only, `test:live-db`, `verify:static`, `verify = verify:static && test:live-db`, `verify:live-db-verdict`. Wired the new classifier test into `test:ops`. |
| `scripts/ci/live-db-verdict.ts` | added | Verdict classifier — runs `test:live-db`, classifies `passed`/`code_failed`/`infra_unavailable`/`proof_skipped`; exits non-zero **only** on `code_failed`. |
| `scripts/ci/live-db-verdict.test.ts` | added | 8 deterministic offline tests of the classifier (no live DB). |
| `.github/workflows/ci.yml` | modified | `Verify` step → `pnpm verify:static`; former DB-smoke step → `Live DB proof (classified)` (`pnpm verify:live-db-verdict`); verdict surfaced in job summary. |
| `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_BRANCH_PROTECTION.md` | added | Implementation notes + the 4-state→CI mapping + manual branch-protection/required-check recommendation. |

## live/local classification (verified, not trusted)
Confirmed the 7 `test:t1-proof:local` files contain no `createClient`/repository/live-Supabase usage (markers were string args like `assertAuthority('service_role', …)` and comments). The 13 `:live` suites write to picks/audit_log/execution_intents/settlement/etc.

## T1 strictness preserved
The separate fail-closed `T1 Proof Gate` (runs `ci:db-smoke` for `tier:T1`) is unchanged → T1/runtime lanes still require live proof; UTV2-1288 still cannot merge without real `test:db`. No PM-gate bypass.

## Guardrails
No weakening of T1 gates. No fabricated proof. No PM-gate bypass. No Discord. No P3 cert. No CLV/ROI/edge claims. No live backfill. No secrets.
