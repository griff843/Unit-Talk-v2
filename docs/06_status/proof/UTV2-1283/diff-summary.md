# UTV2-1283 — Diff Summary

Make a single MLB ingest cycle unable to wedge the process: yield the heavy
synchronous phases so the per-league timeout can fire.

## Problem (live, prod @ ae1017d1 / UTV2-1282)

UTV2-1282 eliminated overlapping MLB cycles (5–7 → 1) and the DB statement timeout.
But the **single** MLB cycle still wedged: one cycle observed `running` for **8.5 hours**,
and **no cycle for any league started after it** — the whole ingestor loop stalled.

The 240s per-league bound (UTV2-1280) is a `setTimeout` race. A `setTimeout` callback —
and an `AbortSignal` abort — can only run when the Node event loop is free. The MLB
cycle has heavy **synchronous** phases that block the event loop on a full slate:
- `sgo-fetcher.ts` — `pairEventOdds` / `collectOddsRows` run synchronously over every
  event (twice per event: in `extractResolvedEvent` and in the pairing loop).
- `ingest-league.ts` — the normalization `map().filter().map()` over the full
  `fetched.pairedProps` (tens of thousands of rows).

While the main thread is blocked, the 240s timer never fires → the cycle is never
aborted → the loop wedges. (A pure-JS watchdog can't help either: SIGTERM queues until
the event loop is free, and `process.exit` can't run during a sync block.)

## Fix

### `apps/ingestor/src/cooperative.ts` (new)
- `yieldToEventLoop()` — `setImmediate`-based yield.
- `mapCooperatively(items, fn, {chunkSize, signal})` / `flatMapCooperatively(...)` —
  run the transform synchronously within each chunk, then **yield to the event loop**
  and **check the abort signal** between chunks. Light inputs take a no-await fast path.

### `apps/ingestor/src/sgo-fetcher.ts`
`fetchAndPairSGOProps` resolves events and pairs odds via `mapCooperatively` /
`flatMapCooperatively` (threading `options.signal`) instead of synchronous loops.

### `apps/ingestor/src/ingest-league.ts`
The offer normalization runs via `mapCooperatively` (signal-threaded). Added
`phaseTimings` (a `timePhase` wrapper around `dedup` and `normalize`) recorded in the
run `details` on **both** success and failure — so a slow/blocking phase is visible
from `system_runs.details` even when a cycle fails closed on timeout. Logged at cycle end.

### Tests — `apps/ingestor/src/cooperative.test.ts` (new)
6 tests. The decisive one: a timer-based abort (the same mechanism as the 240s
timeout) interrupts a 200k-item cooperative transform **mid-flight** (processes far
fewer than all items) — which is only possible because the transform yields. A
blocking map would run to completion before the `setTimeout(0)` could fire.

## Net behavior
With the heavy phases yielding, the existing 240s per-league timeout fires → the MLB
cycle fails closed and the loop proceeds to the next league (UTV2-1280/1282 semantics
intact: singleton, terminal release, bounded dedup). On a normal slate the cycle simply
completes (yielding adds negligible overhead). No DB/schema change, freshness gate
unchanged, event-model unchanged.

## Out of scope
No migration, no schema parity, no `missing_event_context`, no backfill, no fabricated
picks, no production evidence mutation beyond normal ingestor behavior.
