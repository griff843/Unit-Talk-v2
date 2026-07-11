# UTV2-1516 Diff Summary

## Summary

UTV2-1516 adds a local full-verification throttle so concurrent lanes do not run memory-heavy verification suites at the same time on constrained WSL2 hosts.

## Files Changed

- `scripts/ops/preflight.ts` adds a file-system semaphore around the PB1/PB2 baseline section (`pnpm type-check` and `pnpm test`). The default is one active slot, overrideable with `UNIT_TALK_FULL_VERIFY_CONCURRENCY`.
- `scripts/ops/lane-maximizer.ts` reports the current semaphore state in `dispatch_plan.lane_saturation_forecast.full_verify_throttle` and includes throttle guidance in safe-class recommendations.
- `docs/governance/LANE_CONCURRENCY_POLICY.md` documents the independent full-verification throttle and its relationship to executor lane caps.

## Behavior

- Preflight serializes full baseline verification independently from Claude/Codex executor capacity.
- Throttle slots are recorded under `.out/ops/preflight/full-verify-semaphore/`.
- Stale throttle slots older than six hours are ignored by maximizer and removed by preflight acquisition.
- Executor caps in `docs/governance/CONCURRENCY_CONFIG.json` are unchanged.

