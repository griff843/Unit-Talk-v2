# PROOF: WORK-2026101103

MERGE_SHA: pending merge

Issue: WORK-2026101103
Tier: T1
result: pass

Documentation-only, static proof. Tier T1 is the mechanical floor: `docs/00_constitution/` is a Tier C prefix. No code, schema, workflow, branch-protection, runtime, containment or merge-authority change; no control is wired, deleted or weakened.

## ASSERTIONS:

- `CONSTITUTION_IMPLEMENTATION_MATRIX.md` defines an explicit status vocabulary with a legend, keeps every prior claim, and re-statuses every row with file:line evidence from `git grep` against `origin/main` `9ff70858cd0095a3ced7b4232c2cdb97ad5bf45f`.
- `CERTIFICATION_GAP_REGISTER.md` D-CONST-5 is annotated, with its history kept, with the measured fact that `computeStatProjection` has no non-test caller.
- The matrix carries a "Verified on 2026-10-11 against main 9ff70858c" note and the reproducible commands, and states what was not verified.
- Code-level follow-ups are listed in the matrix and not edited.
- `REQUIRED_CI_CHECKS.md` is intentionally out of scope (WORK-2026101102 / PR #1737 holds its lease); it follows in a separate lane.

## EVIDENCE:

Production-caller scan, run from the lane worktree against `origin/main` (`9ff70858c`):

```
git grep -n -w SYMBOL origin/main -- apps packages scripts ':!*.test.ts' ':!**/dist/**' ':!*.d.ts' ':!*.md'
```

Results used: no caller outside the defining file for `enforceAllAuthorities`, `assertFieldAuthority`, `assertApprovalNotExpired`, `authorizeRollback`, `computeStatProjection`, `computeStatMarketBlend`, `routeNegativeEvDecision`, `wireEngine`; `enforceAuthority` and `assertAuthority` only inside `apps/api/src/authority-enforcement.ts` (itself unimported); `replayPromotion` and `replayRecordedPromotion` only inside `packages/domain/src/promotion.ts`. Callers exist for `computeKellySize`, `computeRiskScore`, `evaluatePromotionEligibility`, `computeBoardFitScore`, `checkExposureGate` (`promotion-service.ts:434`), `computeCLVOutcome`, `invalidateExpiredCertificationProofs` (`apps/worker/src/index.ts:74`), `DeliveryCircuitBreaker` (`apps/worker/src/runner.ts:122`), `isKilled` (`runner.ts:303`).

DB controls: `CREATE TRIGGER` lines in `supabase/migrations/00000000000000_baseline_live_schema.sql` (`:5451`-`:5689`); `grep -i -E 'drop trigger|disable trigger'` over all 137 migrations returned no match; no application code writes `settlement_corrections` (only `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts` references it).

CI facts used by the matrix: branch protection on `main` read with `gh api repos/griff843/Unit-Talk-v2/branches/main/protection` on 2026-10-11: contexts `verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`; `strict: true`; `enforce_admins: false`.

Not verified (stated in the matrix): live `pg_trigger`/constraint catalogs; whether the UTV2-1370 retention migration is applied in production; the original matrix's runtime counts (audit_log rows, dead-letters, test counts); RLS and advisor findings; `ci-doctor` behaviour.

## Verification

- `pnpm verify:quick` in the lane worktree: exit 0 (sync-check, env, lint, type-check).
- `git diff --stat origin/main...HEAD` touches only: `.ops/work/WORK-2026101103.md`, the two `docs/00_constitution/` documents, lane manifest and sync metadata, and this proof directory.
- Full `pnpm verify` and `pnpm test:db` are run by the required `verify` CI context on the PR head, not locally (the local `verify` cannot exit 0 offline); the CI result is reported on the PR.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
