# Diff summary: WORK-2026092806

| File | Change |
|---|---|
| `scripts/ops/proof-schema.ts` | Binds the pending receipt to immutable run/job heads plus authoritative repository/PR identity, and deepens only the authoritative PR ref when a shallow checkout lacks the immutable evidence commit. |
| `scripts/ops/proof-schema.test.ts` | Reproduces a real depth-1 UTV2 migration-lane checkout, proves authoritative PR-history recovery, and retains the receipt, ancestry, proof-only-path, fabricated-receipt, and post-merge refusal mutations. |
| `docs/06_status/lanes/WORK-2026092806.json` | Rebinds the still-open repository-owned work-order lane from merged PR #1680 to continuation PR #1687 through the canonical manifest updater. |
| `docs/06_status/proof/WORK-2026092806/*` | Rebinds the candidate proof to the immutable implementation source and current continuation PR. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1687
Execution SHA: 2181fa3ada25ddb667de5563ae9ee6bac970552d
