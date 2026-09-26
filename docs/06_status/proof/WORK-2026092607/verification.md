# PROOF: WORK-2026092607

MERGE_SHA: pending merge

> Pre-merge, merge authority does not exist yet. `post-merge-lane-close.yml` binds the merge
> SHA after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-26T17:04:14.000Z
Issue: WORK-2026092607
Tier: T2
Lane type: governance
Branch: claude/work-2026092607-warehouse-telemetry-coverage
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1659
Head SHA: 386c008dbcd0e8171526bd31fa5f6bbad74478b5
result: pass

## ASSERTIONS:

- [x] The daily conveyor archives `raw_payloads`, `odds_snapshots` and `system_runs` at the
      architecture's hot retention (21 / 45 / 90 days), each under its own `raw/{table}/` prefix.
- [x] `system_runs` windows on `started_at`; a run with a null `finished_at` is archived, not dropped.
- [x] A JSON document column (`details`, `payload`, `price_blob`) survives export and reads back.
- [x] Every policy entry is a backfill source using the identical entry, so a backfilled day and a
      conveyor day are one key; the workflow's dispatch choices equal `BACKFILL_SOURCES` exactly.
- [x] No two sources share a data key or a manifest key on any day of four years.
- [x] Only `provider_offers_legacy_quarantine` carries a prune hold.
- [x] A canonical entry without a domain is refused rather than filed under a guessed one.
- [x] No secret, environment, bucket, grant or production row was created or changed. Nothing was
      archived. The only production statements were read-only measurements (catalog, counts, pattern scans).

## EVIDENCE:

Measured at `386c008dbcd0e8171526bd31fa5f6bbad74478b5` in the lane worktree.

```
$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 169
# pass 169
# fail 0

$ pnpm test
pass 6983, fail 0 (105 suites), rc=0

$ pnpm type-check
rc=0

$ pnpm exec eslint scripts/warehouse/
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092607 --base origin/main --head HEAD
Verdict: PASS
Changed files: 12
Rules matched: (none) — no R-level artifacts required for this diff
```

Mutation battery. Each mutation applied alone, the warehouse suites run, the file restored:

| # | Mutation | Observed |
|---|---|---|
| M1 | `system_runs` removed from the workflow's source choices | red: backfill dispatch mode test |
| M2 | `system_runs` removed from `BACKFILL_SOURCES` | red: 3 tests |
| M3 | `requireDomain` returns a guessed domain | red: canonical entry without a domain is refused |
| M4 | `system_runs` windowed on `finished_at` | red: 2 tests |

Restore check: 169/169.

Live measurements (read-only, production, 2026-09-26): RLS enabled on all three tables
(`system_runs` 0 policies, `raw_payloads` 2, `odds_snapshots` 1); ranges and largest windows in
`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md` §3c; credential-pattern scan of every payload, price blob
and non-heartbeat run detail plus a 29,470-row heartbeat sample: zero hits.

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6983 passed, 0 failed
- [x] `pnpm verify`: not claimed locally. `scripts/ci/assert-staging-target.ts` refuses the
      containment placeholder by design; `verify` runs in CI on this PR and on the merge SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092607 --base origin/main --head HEAD`: PASS, 12 changed files, no R-level artifacts required

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1659
Execution SHA: 386c008dbcd0e8171526bd31fa5f6bbad74478b5

## Runtime Verification

The conveyor and backfill tests run the real `runConveyor` / `runBackfill` against an in-process
DuckDB source and an in-memory object store, export real Parquet and verify each object by reading
it back. No production bucket or credential was touched. Starting a production backfill and the
reader grants remain PM-reserved.
