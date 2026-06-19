# UTV2-1283 — Verification

**Issue:** UTV2-1283 — MLB ingestion cycle wedges past the 240s bound (event-loop block defeats the timeout).
**Branch:** `griffadavi/utv2-1283-mlb-cycle-eventloop-block` · **Lane type:** runtime · **Tier:** T1
**Base SHA:** `ae1017d1` · **Verified source SHA:** `bbc5370451a29d6b09660fde97ec48809301817e` · **Merge SHA:** _(bound post-merge)_

> apps/ingestor only — no DB/schema change. No production rows mutated by this lane.

## Root cause (live evidence)

Post-UTV2-1282 (`ae1017d1`): overlap eliminated (1 MLB cycle), but a single MLB cycle
ran `running` for **8.5 hours** and **no cycle for any league started after it** — the
loop wedged. The 240s per-league bound (`setTimeout` race) **cannot fire while the Node
main thread is blocked synchronously**. Heavy synchronous phases — SGO `pairEventOdds`
over every event (×2) and the offer normalization `map/filter/map` over the full slate —
block the event loop, so the timer never fires and the cycle is never aborted.

## Fix

Make the heavy phases **yield** to the event loop in abort-checkpointed chunks
(`mapCooperatively` / `flatMapCooperatively`), so the per-league timeout fires (the
cycle fails closed, the loop proceeds) and the abort signal is observed mid-transform.
Plus phase-level timing recorded in `system_runs.details` (success + failure).

## Verification — commands run on the branch

- `pnpm verify:parallel` (lint + type-check, then build + test) → **PASS** (lint/type-check/build green; all in-memory suites pass). The DB-backed smoke suite hit one live `canceling statement due to statement timeout` flake (the prod DB is still recovering) and **passed 7/7 on immediate retry** — environmental, not a code regression.
- `pnpm test:db` (live Supabase smoke, T1 runtime proof) → **PASS — 7/7** (clean re-run). node:test TAP summary:

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 124294.287815
```
- Focused: `tsx --test apps/ingestor/src/cooperative.test.ts` → **6/6 PASS**, including the
  decisive proof — a timer-based abort (same mechanism as the 240s timeout) interrupts a
  200k-item cooperative transform **mid-flight**; a blocking map cannot.
- Regression: `tsx --test apps/ingestor/src/*.test.ts` → **209 tests, 205 pass, 0 fail** (4 todo/skip).

## Why this is the right fix (mechanism)

A pure-JS watchdog can't interrupt a synchronous block (SIGTERM queues until the loop is
free; `process.exit` can't run mid-block). The only app-level remedy is to stop blocking —
i.e. yield — so the existing, already-deployed 240s timeout becomes effective. The fix
keeps UTV2-1280/1282 semantics intact (per-league singleton, terminal-timeout release,
bounded dedup) and adds negligible overhead on a normal slate.

## Runtime proof posture

T1 runtime proof = live Supabase smoke (`pnpm test:db`). The **live production proof** —
MLB cycle succeeds or fails closed within the bound; no cycle runs past timeout; fresh
`provider_offer_history` rows persist (incl. `provider_participant_id`); results ingest
reached; funnel moves past ingestion or reports the next blocker — is the post-deploy
live funnel re-check. Phase timings will be visible in `system_runs.details` post-deploy.

## R-level

Runtime lane, apps/ingestor only + tests + proof. No migration, no schema, no new
dependency, no secret handling, no DB query/index change.
