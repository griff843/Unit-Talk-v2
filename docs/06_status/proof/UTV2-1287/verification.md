# UTV2-1287 Runtime Verification

Issue: UTV2-1287
Tier: T1
Lane type: runtime
Branch: griffadavi/utv2-1287-game-results-finalization-telemetry
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1038
Head SHA: 0d9a8fe1a652033fedbadb79c5e8b70003c4060f
Merge SHA: 7c6e8922ae0b27faab4de2125a26c264cda94915 (PR #1038 squash merge)

## Summary

Diagnostic-only telemetry for the game-results finalization/results funnel. **No behavior change** to the finalize/results gate, scoring, freshness, or insert logic. After the watchdog hot-fix unblocked the finalized-repoll/results path (`game_results` flowing again), a residual of finished MLB games still never reach `events.status='completed'`, so `resolveAndInsertResults` silently skips their results. This instruments the funnel so a prod log scan localizes the residual cause before any speculative fix.

## Change

- `apps/ingestor/src/results-resolver.ts`: `ResultsResolutionSummary` gains `skippedEventNotFound` + `skippedEventNotCompleted`, attributed at the event gate (mapping miss vs status-transition gap). Emits one structured `[results-telemetry]` line per call (finalized_results_in / completed / inserted / skipped_event_not_found / skipped_event_not_completed / skipped_markets / errors). Correlate with the existing `finalized-repoll … candidates=N` line: candidates(N) vs finalized_results_in(M) reveals SGO-not-finalized = N − M.
- `apps/ingestor/src/results-resolver.test.ts` (new): reason attribution + funnel line.
- `package.json`: register the new test in `test:apps-rest`.

## Verification

- [x] `pnpm type-check`: **PASS** (project references build clean)
- [x] `pnpm verify:parallel`: **PASS** — `[verify:parallel] all checks passed`
- [x] Focused test — `tsx --test apps/ingestor/src/results-resolver.test.ts`: **4/4 PASS**
  - completed event → inserts + counts completed
  - finished `in_progress` event → `skippedEventNotCompleted` (the residual)
  - unmapped providerEventId → `skippedEventNotFound`
  - `[results-telemetry]` funnel line emitted with full breakdown
- [x] `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`): **7/7 PASS**

### Focused test — node:test TAP summary

```
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### `pnpm test:db` — node:test TAP summary (live Supabase)

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Runtime Verification (post-deploy — pending merge + deploy)

This is observation-only telemetry; correctness is proven by the focused tests above. Post-deploy, the `[results-telemetry]` line will appear once per finalized-repoll results pass in prod logs. The follow-up diagnostic reads those lines across a full slate to pin the residual (SGO-not-finalized vs status-transition gap vs mapping miss). No production mutation beyond the existing results flow.

## SHA Binding

Head SHA: 0d9a8fe1a652033fedbadb79c5e8b70003c4060f
Merge SHA: 7c6e8922ae0b27faab4de2125a26c264cda94915 (PR #1038 squash merge)
