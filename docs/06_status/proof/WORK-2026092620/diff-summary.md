# WORK-2026092620 Diff Summary

Generated at: 2026-09-26T17:33:13.000Z
Issue: WORK-2026092620
Tier: T2
Lane type: governance
Branch: claude/work-2026092620-effective-settlement-scripts
PR URL: PR_URL_TBD
Head SHA: 76f3bad230845df6cd61e94b4b6dce73932c401d
Merge SHA: pending merge
Diff base: eb5559426b790e694b38a1de85ec99891790d238 (origin/main)
Diff target: 76f3bad230845df6cd61e94b4b6dce73932c401d

## Git Diff Stat
```
 .ops/sync/WORK-2026092620.yml                 | 142 +++++++++++
 docs/06_status/lanes/WORK-2026092620.json     |  42 +++
 docs/06_status/proof/WORK-2026092620/.gitkeep |   0
 scripts/band-accuracy.ts                      | 105 +++++---
 scripts/clv-dashboard.ts                      |  85 ++++---
 scripts/effective-settlements.ts              | 282 ++++++++++++++++++++
 scripts/portfolio-review.ts                   | 105 +++++---
 scripts/roi-by-sport.test.ts                  | 354 ++++++++++++++++++++++++++
 scripts/roi-by-sport.ts                       | 111 ++++----
 scripts/scoring-provenance.ts                 | 109 ++++++--
 10 files changed, 1153 insertions(+), 182 deletions(-)
```

## What changed

- `scripts/effective-settlements.ts` (new): the one shared reader. Candidate picks are selected by
  their ROOT record's date window (`corrects_id IS NULL`), paged with an ordered `range`
  (date column, then `id`). Every record of every candidate pick is then loaded, whatever its
  date, in 200-id `.in('pick_id', ...)` chunks, each chunk paged with an ordered `range`.
  Each pick resolves through `resolveEffectiveSettlement` from `@unit-talk/domain`, and the
  answer is accepted only when every `corrects_id` target is present and
  `correction_depth + 1` equals the chain's row count. Anything else is returned as
  unresolved with a reason, never counted with its root.
- `scripts/roi-by-sport.ts`: `fetchRoiRows(client, afterDate)` reads result, payload and
  settled_at from the effective record; the report prints an unresolved-chain row; monitor
  mode warns on stderr, leaving its JSON unchanged.
- `scripts/clv-dashboard.ts`: `loadClvDashboardRows(client, options)` reads result and CLV
  from the effective record; the report carries `unresolvedPickCount`, printed in markdown.
- `scripts/band-accuracy.ts`: `fetchBandRows` + `summarizeBands` (now used by the band
  table); unresolved row in the summary; `main` runs only when invoked directly.
- `scripts/portfolio-review.ts`: `fetchPeriodSettlements` / `summarizeChampionSettlements`;
  the 500-row settlement sample is now the newest 500 picks by root `created_at` (it was an
  unordered `.limit(500)`); unresolved count in the packet and the printout. Environment and
  client construction moved into `main`, which runs only when invoked directly.
- `scripts/scoring-provenance.ts`: `fetchRecentSettlements` / `toCoverageRecords` /
  `summarizeAutoGrade`; CLV and auto-grade coverage read the effective record's payload and
  source; unresolved count in the CLV detail. Environment and client construction moved into
  `main`, which runs only when invoked directly.
- `scripts/roi-by-sport.test.ts`: 14 new tests (18 total) — resolver completeness, root-window
  selection, paging past 1000 rows with an unstable-order fake, id chunking, and one test per
  script proving its aggregation consumes the effective result.
