# UTV2-1459 Verification

## Summary

| Field | Value |
| --- | --- |
| Issue | UTV2-1459 |
| Tier | T2 |
| Branch | claude/utv2-1459-t1-proof-freshness-skip |
| Commit SHA(s) | `bef7044e8e6e6308056270cc45c5e3c72744731c` (branch head) |

## Verification

- [x] `pnpm type-check` — passed, no errors
- [x] `pnpm test` — full suite green, 0 failures
- [x] `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` run directly against live (stale) production data — confirmed the target test now reports `SKIP` with an explicit stale-data reason (`most recent provider_offer_history row (2026-06-30T12:41:02.424+00:00) is older than the 72h lookback window...`), not a failure
- [x] 3 new unit tests added for `isSnapshotWithinLookback()` (fresh / stale / null-unparseable input) — all pass

## Scope

Test-only change. `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` modified; no runtime, domain, contract, or migration paths touched.

## Merge SHA Binding

Head SHA: `bef7044e8e6e6308056270cc45c5e3c72744731c`
Merge SHA: `5206e6e1d87787271f512d1b01009c71ad752628` (PR #1147, squash-merged 2026-07-06T17:59:45Z)

## Post-merge verify and R-level evidence

- `pnpm verify` — PASS on merge SHA `5206e6e1d87787271f512d1b01009c71ad752628`. `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts`: 3 pass + 1 skip (explicit stale-data reason), 0 fail — confirms the fix's intended effect on the actual merged code.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS. Verdict: PASS, changed files vs merged main: 0, no R-level artifacts required for this diff.

## Live DB Verification

`pnpm test:db` executed 2026-07-04 against live Supabase (project `zfzdnfwdarxucxtaojxm`), run from the repo root at main containing this branch's base — DB smoke exercises the same live schema this test change reads:

```
pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 117101.758818
```
