# UTV2-1647 Diff Summary

Generated at: 2026-08-02T00:57:25Z
Issue: UTV2-1647
Tier: T2
Lane type: governance
Branch: codex/utv2-1647-ci-db-proof-harvest-fix
Implementation SHA: eda33086ad2ff4415cc64facf58c3445619c67b5

## Summary

- Query the GitHub workflow-specific `ci.yml` runs endpoint for the pull request head SHA instead of truncating repository-wide workflow runs at 20 entries.
- Request up to 100 runs and retain a bounded repository-wide fallback for compatible GitHub installations and injected executors.
- Preserve fail-closed run and job selection while adding a regression fixture based on UTV2-1646 / PR #1356, where CI was item 21 of 25 repository-wide runs.

## Files Changed

- `scripts/ops/ci-db-proof-harvest.ts` — selects the exact CI workflow endpoint and uses a non-truncating compatibility fallback.
- `scripts/ops/ci-db-proof-harvest.test.ts` — updates endpoint expectations and covers the item-21 regression plus fallback behavior.
- `.ops/sync/UTV2-1647.yml`, `docs/06_status/lanes/UTV2-1647.json`, and the proof directory marker — lane-start governance artifacts already present on the lane branch.
- `docs/06_status/proof/UTV2-1647/*` — required T2 closeout evidence.

## Implementation Diff Stat

```text
scripts/ops/ci-db-proof-harvest.test.ts | 105 ++++++++++++++++++++++++++++++--
scripts/ops/ci-db-proof-harvest.ts      |  24 +++++++-
2 files changed, 123 insertions(+), 6 deletions(-)
```

## Behavioral Result

For merge SHA `6adaa5d08016971f90ba4cac68bad23e894555a5`, the captured PR head SHA is `37f0c092a7903af2db49ad5f53ce04a039ca6088`. The workflow-specific lookup finds completed CI run `30704058474` and DB proof job `91379988421`, even though the old repository-wide `per_page=20` query omitted that run.
