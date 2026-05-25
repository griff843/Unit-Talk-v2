# UTV2-1164 Diff Summary

## Summary

- Added merge-risk forecast support for candidate branch vs base drift, active-lane branch file conflicts, declared scope overlap, and candidate scope bleed.
- Integrated forecast output into `scripts/ops/merge-risk.ts` behind `--forecast` while preserving the existing merge-risk report shape.
- Added focused `node:test` coverage for drift warnings, active-lane conflict blocks, declared scope checks, and clean merge-order recommendations.

## Files Changed

- `scripts/ops/merge-risk.ts` - adds forecast data structures, conflict forecasting, merge-order recommendation text, and CLI flags.
- `scripts/ops/merge-risk.test.ts` - covers the new forecast behavior with focused unit tests.
- `.ops/sync/UTV2-1164.yml` - records lane sync metadata required by the repo verification gate for this issue branch.
- `docs/06_status/proof/UTV2-1164/diff-summary.md` - summarizes the implementation.
- `docs/06_status/proof/UTV2-1164/verification.log` - records verification evidence.

## Forecast Result

Command:

```bash
npx tsx scripts/ops/merge-risk.ts --forecast --branch codex/utv2-1164-conflict-forecasting --base main --files scripts/ops/merge-risk.ts,scripts/ops/merge-risk.test.ts --scope scripts/ops/merge-risk.ts,scripts/ops/merge-risk.test.ts
```

Result:

- Forecast candidate files matched declared scope.
- Forecast conditions were empty.
- Merge order recommendation: `No active lane or main-drift conflicts forecast.`

## Scope Notes

No runtime, domain, database, migration, worker, or API service files were touched. The proof files are required by the UTV2-1164 execution packet.
