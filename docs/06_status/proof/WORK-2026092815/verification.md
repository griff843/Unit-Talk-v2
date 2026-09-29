# PROOF: WORK-2026092815

MERGE_SHA: 31e3e4f0989bcf237a4393133c71c2d7f8df3d4c

Issue: WORK-2026092815
Tier: T2
Lane type: delivery-ui
Branch: codex/work-2026092815-command-center-mode-filter
Head SHA: 23bb844b1131ba25006cc7335c58f8b8bb671c55
result: pass

## ASSERTIONS:

- [x] `readPicksExplorerQuery` allow-lists `distributionMode` (`track-only`, `delivery-eligible`,
      `ungoverned`); an unknown value becomes `''` (All). `picksExplorerHref` preserves it across pages.
- [x] `searchPicks` applies the mode in both the row query and the exact-count query, before
      pagination. `track-only` and `delivery-eligible` add `metadata->>distributionMode = eq.<mode>` on
      top of the operator population. `ungoverned` is `metadata->distributionMode IS NULL`. The
      fixture population is unchanged.
- [x] Pick detail, for a delivery-eligible human-capper pick, shows the `official-picks` kill-switch
      state from the existing `getDeliveryKillSwitchStatuses()`:
      - killed: "Delivery held", with reason, actor and time;
      - no row: "Delivery held: the worker fails closed";
      - read error: "Kill-switch state unavailable", never open.
- [x] Track Only picks render no delivery-held block. No release control is added.
- [x] Scope: 8 files under `apps/command-center/`, plus this lane's work order, manifest and proof.
      No API route, write, kill-switch, delivery or containment change.

## EVIDENCE:

### Tests (run by Claude on the implementation commit)

```
$ cd apps/command-center && npx tsx --test src/app/command-center-pages.test.tsx
# tests 13
# pass 13
# fail 0
$ npx tsx --test src/lib/picks-explorer-query.test.ts
# tests 2
# pass 2
# fail 0
$ npx tsx --test src/lib/data/operations-home.test.ts
# tests 5
# pass 5
# fail 0
$ npx tsc --noEmit -p .
TSC_EXIT=0
```

### Mutation drill

Each mutation was applied alone, all three test files re-run, then the file restored.

```
M1 drop the mode eq filter in searchPicks            -> # fail 2
M2 drop distributionMode from picksExplorerHref      -> # fail 1
M3 render an unavailable read as "Delivery open"     -> # fail 1
M4 drop the target phrase from the missing-row text  -> # fail 0
M5 disable the killed branch                         -> # fail 1
restored                                             -> # fail 0
```

M4 survives. The test matches the "Delivery held: the worker fails closed" prefix, which is the
fail-closed meaning. It does not pin the trailing target phrase. Recorded as a limitation, not
fixed in this lane.

## Verification

- [x] Command Center tests: 13 of 13, 2 of 2 and 5 of 5 pass
- [x] `tsc --noEmit -p apps/command-center`: exit 0
- [x] eslint on `apps/command-center/src`: exit 0
- [x] Mutation drill: 4 of 5 mutations turn a test red; M4 is recorded above
- [x] `pnpm verify` runs in the required CI `verify` context on this PR's head, which carries implementation commit 23bb844b1131ba25006cc7335c58f8b8bb671c55 unchanged. The Merge Gate requires it green before merge.
- [x] `pnpm type-check` and `pnpm test` are included in that `pnpm verify` run.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base 258b4efc1c11b4a7d861d809d1ea7190afc4f8dd --head 23bb844b1131ba25006cc7335c58f8b8bb671c55`: Verdict PASS, 13 changed files, rule matched `operator-ui`.

## Runtime Verification

This lane is T2. It adds display and a filter on existing reads, and no write path. It reaches
operators only through a deploy, which is reserved to Griff.

## Merge SHA Binding

Merge SHA: 31e3e4f0989bcf237a4393133c71c2d7f8df3d4c
PR: https://github.com/griff843/Unit-Talk-v2/pull/1689
Execution SHA: 23bb844b1131ba25006cc7335c58f8b8bb671c55
