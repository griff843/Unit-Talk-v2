# UTV2-1514 Diff Summary

## Summary

- Added `scripts/ops/tier-classifier.ts`, a pure advisory mechanical tier classifier that computes `derived_tier = max(declared_tier, mechanical_minimum(diff))`.
- Exported and extended the shared Tier C path authority in `scripts/ops/merge-risk.ts` so the classifier does not fork a parallel sensitive-path list.
- Added `scripts/ops/tier-classifier.test.ts` with regression coverage for T1 escalation, no downgrade behavior, shared-constant sourcing, and advisory-first output.

## Diff Scope

- `package.json` (wire `scripts/ops/tier-classifier.test.ts` into the `test:ops` script list)
- `scripts/ops/merge-risk.ts`
- `scripts/ops/tier-classifier.ts`
- `scripts/ops/tier-classifier.test.ts`
- `docs/06_status/proof/UTV2-1514/diff-summary.md`
- `docs/06_status/proof/UTV2-1514/verification.md`
- `docs/06_status/proof/UTV2-1514/sweep-report.md`

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

## Baseline / Sweep Report (spec section 3, step 5)

Per PM decision, `docs/06_status/proof/UTV2-1514/sweep-report.md` runs the classifier against the 20 most recent *done* lane manifests (UTV2-1449 through UTV2-1494, a mix of T1/T2/T3) as advisory evidence for the Phase 2 (blocking) go/no-go decision. Summary: 9/20 lanes (45%) would have been escalated, all T2 → T1, concentrated in `.github/workflows/*.yml` and `scripts/ops/lane-*.ts`/`merge-*.ts` paths. No T1 lane was escalated further and no T3 lane crossed into escalation in this sample — the no-downgrade invariant held throughout. See the full report for the per-lane table and interpretation.
