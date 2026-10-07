# Diff summary: WORK-2026100701

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Runs exact-SHA CI/staging proof for every protected-main commit, including metadata-only merges, without cross-SHA workflow cancellation. |
| `.github/workflows/merge-proof-recovery.yml` | Adds default-branch-controlled, merged-PR-only historical proof recovery with exact checkout, protected staging proof, full static verification, and truthful native-result publication. |
| `scripts/ops/merge-proof-recovery.cjs` | Centralizes fail-closed dispatch, PR/base/repository/ancestry validation and native-job-to-check reporting decisions. |
| `scripts/ops/workflow-hardening.test.ts` | Adds deterministic positive and adversarial regressions for trigger trust, permissions, API wiring, exact checkout, stale/mismatched targets, and non-success proof outcomes. |
| `docs/06_status/proof/WORK-2026100701/**` | Records measured implementation, verification, deferral, and routing evidence for this lane only. |

No G6 evaluator, admission rule, branch protection, production credential, product/runtime
surface, schema, original #1720 proof, or separately authorized P1 workflow was changed.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1724
