# UTV2-1281 — Verification

**Issue:** UTV2-1281 — Event-scope the SGO MLB player-prop fetch so it stops hitting the per-league timeout.
**Branch:** `griffadavi/utv2-1281-event-scope-mlb-player-prop-fetch` · **Lane type:** runtime · **Tier:** T1
**Base SHA:** `b37b9afd` · **Verified source SHA:** `ca4aaa341d628a12b847aed372b79d6e8bf2282c` · **Merge SHA:** _(bound post-merge)_

> Lane executed in the main checkout (main-control mode), zero concurrent active
> lanes (the two merged ghost lanes UTV2-1274 / UTV2-1280 were reconciled to `done`
> first, PR #1027). No production rows mutated by this lane.

## Scope (PM-confirmed: new issue, event-scope only)

Follow-up to the merged per-league cycle bound (PR #1024). That work *contained* the
MLB hang behind a 240s per-league timeout; this lane *resolves* it so MLB completes a
cycle and produces offers. The fix scopes the dedicated player-prop fetch to the
imminent slate's event IDs (in small batches) instead of one league-wide
PLAYER_ID-wildcard query. Game-line / results fetch behavior is unchanged.

## Root cause (live evidence, prod @ 61348ae3, 2026-06-17)

`system_runs` (`run_type=ingestor.cycle`), last 30 min: **MLB — 17 runs, ALL
`status=running`, avg 217.7s**, pinned against the 240s `leagueTimeoutMs` and never
completing; NBA 17 `succeeded` @ 5.0s, NFL 17 `succeeded` @ 2.5s. The league-wide
player-prop query over a full June MLB slate returns a payload large enough to exhaust
the per-league budget across pagination; NBA/NFL run the identical fetch in seconds
because their slates are tiny (offseason). MLB had produced no `provider_cycle_status`
row and no fresh `provider_offer_history` since 2026-06-12.

## Verification — commands run on the branch

- `pnpm verify:parallel` (lint + type-check parallel, then build + test) → **PASS** — exit 0, emitted `[verify:parallel] all checks passed`. (`env:check` runs in CI on the merge SHA.)
- `pnpm type-check` → **PASS** (within verify:parallel).
- `pnpm lint` → **PASS** (within verify:parallel).
- `pnpm build` → **PASS** (within verify:parallel).
- `pnpm test` (full suite) → **PASS** — 0 `not ok` across all sub-suites.
- `pnpm test:db` (live Supabase smoke, T1 runtime proof) → **PASS — 7/7**.
- Focused: `tsx --test apps/ingestor/src/sgo-player-prop-scope.test.ts` → **8/8 PASS**.
- Regression: `tsx --test apps/ingestor/src/*.test.ts` → **198 tests, 194 pass, 0 fail** (4 todo/skip).

## Mechanism proof (unit + integration)

- `selectPlayerPropEventIds` keeps only events whose `startsAt` is in the imminent
  window, drops missing/unparseable starts, dedupes, preserves order (4 tests).
- `chunkEventIds` batches at the default size and honors/c­oerces explicit sizes (2 tests).
- `ingestLeague` issues the player-prop request **event-scoped** (`eventID` = slate
  event), never Pinnacle-only, and issues **no** league-wide prop request when the
  slate has no imminent events (so it cannot hang).
- Rate-limit telemetry regression preserved (game-line fixture made imminent so the
  scoped prop fetch still fires and the quota request count is unchanged).

## Runtime proof posture

T1 runtime proof = live Supabase smoke (`pnpm test:db`, read-only diagnostics + the
standard repo persistence smoke; no production ingestion rows mutated). The **live
production proof** — prod SHA includes this fix, the scheduled MLB cycle completes
(`status=succeeded`) within the bound, and fresh same-day MLB `provider_offer_history`
rows with `provider_participant_id` appear — can only be shown by deployed runtime and
is the post-deploy re-check of the live funnel (the standing UTV2-1279 first-NO).

## R-level

Runtime lane, app code in `apps/ingestor` + tests + proof. No migration, no schema,
no new external dependency, no secret handling. R-level required artifacts: tests
(present) + verification bundle (this file) + diff summary + evidence.json.
