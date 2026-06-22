# UTV2-1286 Runtime Verification

Issue: UTV2-1286
Tier: T1
Lane type: runtime
Branch: griffadavi/utv2-1286-fix-ingestor-watchdog-false-positive-restarts-during-slow
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1037
Head SHA: 967cc52603be4621ac04dea71eb01f09ae62c5ca
Merge SHA: N/A (binds at lane close)

## Problem

The prior ingestor-hardening lane stamped one heartbeat per **cycle iteration** (at
the top of `runIngestorCycles`, before any work). A single cycle's wall-clock —
4 leagues × the per-league bound (`leagueTimeoutMs`, default 240s) + finalized-repolls
+ odds-api + grading — can far exceed the 20-min watchdog threshold
(`DEFAULT_HEARTBEAT_MAX_AGE_MS`). So a slow-but-progressing MLB cycle went "stale" and
the in-process watchdog force-exited it: `ingestor loop watchdog: heartbeat stale —
forcing exit`. That is a false positive — the loop was advancing, just slowly.

## Fix

Emit a loop-progress signal at **every phase boundary** instead of once per cycle, so
the inter-progress gap is bounded by a single phase (≤ `leagueTimeoutMs`) rather than a
whole multi-league cycle. The watchdog keys off the last **progress** timestamp via the
pure `shouldWatchdogForceExit(lastProgressAt, maxAgeMs, now)` and force-exits only on a
true no-progress wedge. The heartbeat is written **only on progress**, so it can never
mask a wedge. Real wedge detection and the `restart: unless-stopped` recovery path are
unchanged.

Progress phases emitted: `cycle-start`, `league-start`/`league-end` (and `league-skip`)
per league, `finalized-repoll-start`, `finalized-repoll-batch` (per batch),
`finalized-repoll-end`, `odds-api` (per league), `grading`, `cycle-end`.

## Verification

- [x] `pnpm type-check`: **PASS** (project references build clean)
- [x] `pnpm verify:parallel`: **PASS** — `[verify:parallel] all checks passed` (env:check, lint, type-check, build, full unit suite)
- [x] Focused lane tests — `tsx --test apps/ingestor/src/heartbeat.test.ts apps/ingestor/src/ingestor-loop-resilience.test.ts`: **14/14 PASS**, including:
  - `UTV2-1286: progress is emitted per-league and per-phase, not once per cycle`
  - `UTV2-1286: a slow-but-progressing cycle never trips the watchdog (no false positive)`
  - `UTV2-1286: a true no-progress wedge still trips the watchdog`
  - `writeHeartbeat → readHeartbeat round-trips the UTV2-1286 progress fields`
  - existing resilience tests updated to the new hook signature (still green)
- [x] `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`): **7/7 PASS** (~119s). Read-only; this change adds no schema and no new DB writes — it only changes the in-process liveness signal.

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
# duration_ms 119157.599841
```

### Focused lane tests — node:test TAP summary

```
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Runtime Verification (post-deploy — pending merge + deploy)

The fix is proven statically by the reproduction tests above (a slow-but-progressing
cycle whose total wall-clock far exceeds the threshold never trips the watchdog, while a
true no-progress wedge still does). The live post-deploy assertion runs after merge +
deploy and must show:

- exactly one ingestor container
- container healthcheck OK (loop-progress heartbeat fresh)
- restart count stabilizes (no more watchdog false-positive exits in logs)
- the loop keeps advancing through phases (`cycle-start` -> `league-*` -> `finalized-repoll-*` -> `cycle-end`)
- MLB provider offers continue advancing

## SHA Binding

Head SHA: 967cc52603be4621ac04dea71eb01f09ae62c5ca
Merge SHA: N/A (bound automatically at lane close by `post-merge-lane-close.yml`)
