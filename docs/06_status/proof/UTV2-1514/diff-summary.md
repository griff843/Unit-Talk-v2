# UTV2-1514 Diff Summary

## Summary

- Added `scripts/ops/tier-classifier.ts`, a pure advisory mechanical tier classifier that computes `derived_tier = max(declared_tier, mechanical_minimum(diff))`.
- Exported and extended the shared Tier C path authority in `scripts/ops/merge-risk.ts` so the classifier does not fork a parallel sensitive-path list.
- Added `scripts/ops/tier-classifier.test.ts` with regression coverage for T1 escalation, no downgrade behavior, shared-constant sourcing, and advisory-first output.

## Diff Scope

- `scripts/ops/merge-risk.ts`
- `scripts/ops/tier-classifier.ts`
- `scripts/ops/tier-classifier.test.ts`
- `docs/06_status/proof/UTV2-1514/diff-summary.md`
- `docs/06_status/proof/UTV2-1514/verification.md`

## Advisory Classifier Dry Run

Command:

```bash
npx tsx scripts/ops/tier-classifier.ts --declared-tier T2 --files scripts/ops/merge-risk.ts,scripts/ops/tier-classifier.ts,scripts/ops/tier-classifier.test.ts
```

Result:

- `declared_tier`: `T2`
- `mechanical_minimum`: `T1`
- `derived_tier`: `T1`
- `advisory.conclusion`: `neutral`
- Escalating matches: `scripts/ops/merge-risk.ts`, `scripts/ops/tier-classifier.ts`
- Test-only file `scripts/ops/tier-classifier.test.ts` did not trigger the orchestration implementation pattern.
