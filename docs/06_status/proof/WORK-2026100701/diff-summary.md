# Diff summary: WORK-2026100701

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Runs exact-SHA CI/staging proof for every protected-main commit, including metadata-only merges, without cross-SHA workflow cancellation. |
| `.github/workflows/merge-proof-recovery.yml` | Adds default-branch-controlled historical recovery limited to complete metadata-only same-repository merged PRs, with exact checkout, protected staging proof, full static verification, pre-publication run/target revalidation, and truthful native-result publication. |
| `scripts/ops/merge-proof-recovery.cjs` | Centralizes fail-closed dispatch, metadata path/rename/pagination, PR/repository/ancestry, workflow-run attempt, and native-job-to-check reporting decisions; every refused proof concludes failure. |
| `scripts/ops/workflow-hardening.test.ts` | Executes the literal resolver/publisher YAML scripts with injected GitHub API mocks and covers exact success plus code/rename/partial-list/fork/stale-attempt/wrong-run/head/checkout/missing/non-success adversarial cases. |
| `docs/06_status/proof/WORK-2026100701/**` | Records measured implementation, verification, deferral, and routing evidence for this lane only. |

No G6 evaluator, admission rule, branch protection, production credential, product/runtime
surface, schema, original #1720 proof, or separately authorized P1 workflow was changed.

## SHA Binding

Merge SHA: d7f035857c16694411d9f0a84ea4decedc1f8a45
PR: https://github.com/griff843/Unit-Talk-v2/pull/1724
