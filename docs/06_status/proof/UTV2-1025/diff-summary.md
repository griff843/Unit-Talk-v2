# UTV2-1025 Diff Summary

## Summary

Reopened scope: dispatch visibility, digest ranking, and active control-plane alignment hardening.

Head SHA at proof capture: `d9c5ed2855ea11d714e19f0e30834b8ef199a457`.

Merge SHA: `0f858a133fd7f4abff474a020d63265036b0c7d0`.

## Evidence

Changed files:

- `package.json` wires new ops coverage into `pnpm test:ops`.
- `scripts/ops/daily-digest.ts` ranks dispatch candidates from live lane capacity and no longer shells out to `ops:brief`.
- `scripts/ops/daily-digest.test.ts` covers ranking, capacity penalties, singleton conflicts, and deterministic ordering.
- `scripts/ops/execution-state.ts` adds dispatch dashboard fields for executor slots, lane types, stale heartbeats, singleton blockers, forbidden pair blockers, merge mutex truth, and recommended actions.
- `scripts/ops/execution-state.test.ts` covers dashboard summaries and stale heartbeat reporting.
- `scripts/ops/system-alignment-check.ts` fails active control-plane stale references and missing shared concurrency config consumers.
- `scripts/ops/system-alignment-check.test.ts` covers stale reference detection, archive/test exclusions, and missing consumer failures.

## Verification

The dispatch control plane now has mechanical visibility for 6-lane operation and active checks for stale concurrency and lane-registry drift.
