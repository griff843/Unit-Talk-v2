# UTV2-998 Evidence Bundle

Generated: 2026-05-18

## Implementation Proof

- `apps/api/src/submission-service.ts` now normalizes direct service submissions so a newly persisted pick always has measurable `stake_units`.
- HTTP/API human submission handling still rejects omitted or non-positive `stakeUnits`; direct internal service calls without a stake are explicitly labeled with `metadata.stakeUnitsSource = service_default_flat_1u`.
- `scripts/roi-by-sport.ts` now computes ROI from persisted `picks.stake_units` and pick odds. Rows with `stake_units IS NULL` are labeled historical unknown-stake rows and excluded from ROI.

## Null-Stake Row Count Audit

Use:

```bash
pnpm exec tsx scripts/roi-by-sport.ts --after=2026-05-10
```

The report emits:

- `Stake-known rows`
- `Historical unknown-stake rows`
- `ROI (stake-based)`

Runtime capture is blocked in this local Codex sandbox by `spawn EPERM` from `tsx`/Node test-runner process creation before DB access starts.

## ROI Output Sample

Unit-test fixture sample from `scripts/roi-by-sport.test.ts`:

```text
=== ROI / Win-Rate by Sport ===
Query window: settled_at >= 2026-05-10
Generated: 2026-05-18T04:04:47.263Z

## Overall (all sports)
| Metric | Value |
|--------|-------|
| Total settled | 3 |
| Wins | 2 (66.7%) |
| Losses | 1 (33.3%) |
| Pushes | 0 |
| Stake-known rows | 2 |
| Historical unknown-stake rows | 1 |
| Total risked | 3.00u |
| Net units | +0.82u |
| ROI (stake-based) | +27.33% |
| Note | Rows with stake_units IS NULL are labeled historical_unknown and excluded from ROI |
```

## Verification

Passed:

```text
pnpm type-check
pnpm lint
pnpm build
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 0
Rules matched: (none) — no R-level artifacts required for this diff
```

Blocked in this sandbox:

```text
pnpm test:db
Error: spawn EPERM
syscall: spawn
```

```text
pnpm verify
Error: spawnSync C:\WINDOWS\system32\cmd.exe EPERM
syscall: spawnSync C:\WINDOWS\system32\cmd.exe
```

## Live-DB Proof

Not captured in this sandbox. `pnpm test:db` fails before executing `apps/api/src/database-smoke.test.ts` because the Node test runner cannot spawn worker processes. No backfill was run.
