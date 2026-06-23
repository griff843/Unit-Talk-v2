# UTV2-1293 — Diff Summary

**Merge SHA:** `9d5a5827ca55d5cdbd127654a9eed2f18f0960b7` · **PR:** #1047 · **Tier:** T2 · **Lane type:** runtime

## Files changed

- `apps/ingestor/src/index.ts` — daemon-resident contract fix (runtime).
- `docs/06_status/lanes/UTV2-1293.json` — lane manifest (lane apparatus).
- `.ops/sync/UTV2-1293.yml` — sync approval file (lane apparatus).

## Change

1. `MAX_CYCLES=0` mapping: `configuredMaxCycles === 0 ? undefined : configuredMaxCycles`
   → `configuredMaxCycles === 0 ? Number.POSITIVE_INFINITY : configuredMaxCycles`.
   The runner coalesces `options.maxCycles ?? 1` → 1, so `undefined` silently collapsed
   the resident daemon to a single cycle. Explicit `Infinity` makes the loop genuinely
   unbounded. The runner default (`?? 1`) for non-daemon callers is unchanged.

2. Added a ref'd `daemonKeepAlive = setInterval(() => {}, 1 << 30)` at the top of the
   autorun IIFE, cleared in a new `finally` (`clearInterval(daemonKeepAlive)`). The
   watchdog interval is `unref()`'d, so without this a cycle's I/O could momentarily
   leave zero active handles mid-cycle and drain the event loop → clean `exit(0)` →
   `restart: unless-stopped` churn. The keep-alive guarantees liveness for the daemon's
   lifetime; clearing it in `finally` preserves clean exit for finite `maxCycles` and
   fatal errors.

## Behavioral impact (proven in prod)

- Before: daemon ran ~1 cycle then `exit(0)` (~35s churn); per-cycle restarts re-amplified
  `system_runs` bloat; the in-season league + finalized-repoll were frequently never reached.
- After: daemon stays resident through a full cycle including MLB + finalized-repoll
  (candidates=24). RestartCount stabilized. Remaining settlement blockage is downstream
  (DB write-path `statement_timeout` from table bloat) — see `verification.md`.

## Tier rationale

T2 — additive runtime fix to a constant-mapping + event-loop keep-alive in one app entrypoint.
No migration, no schema change, no settlement/promotion/grading path change.
