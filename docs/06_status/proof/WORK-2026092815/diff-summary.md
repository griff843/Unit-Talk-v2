# WORK-2026092815 Diff Summary

Issue: WORK-2026092815
Tier: T2
Lane type: delivery-ui
Branch: codex/work-2026092815-command-center-mode-filter
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1689
Diff base: 258b4efc1c11b4a7d861d809d1ea7190afc4f8dd
Diff target: 23bb844b1131ba25006cc7335c58f8b8bb671c55

| File | Change |
|---|---|
| `apps/command-center/src/lib/picks-explorer-query.ts` | `distributionMode` allow-list; preserved in paging hrefs |
| `apps/command-center/src/lib/data/queues.ts` | `searchPicks` applies the mode to the row and count queries |
| `apps/command-center/src/app/picks/page.tsx` | Distribution-mode select in the filter form |
| `apps/command-center/src/app/picks/[id]/page.tsx` | Reads the `official-picks` switch for delivery-eligible human-capper picks |
| `apps/command-center/src/components/GovernedPickTruth.tsx` | Delivery-held block: killed, missing row, unavailable, disengaged |
| `apps/command-center/src/app/command-center-pages.test.tsx` | Render cases for each state and for Track Only |
| `apps/command-center/src/lib/picks-explorer-query.test.ts` | Allow-list and paging cases |
| `apps/command-center/src/lib/data/operations-home.test.ts` | Asserts the mode filter reaches the query |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1689
