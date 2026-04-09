# Phase 2 Staging Update — 2026-04-09

**Status:** Current-state addendum for repo truth reconciliation  
**Purpose:** Record the current execution state reached after Phase 1 closure and before UTV2-459 / UTV2-460 implementation begins.

---

## Why this file exists

`PROGRAM_STATUS.md` still reflects the 2026-04-08 Command Center/UI closure state and does not yet capture the latest pick-machine sequencing state.

This addendum records the current truth reached on 2026-04-09 so the repo does not drift while UTV2-458 is being closed.

This file does **not** supersede `PROGRAM_STATUS.md`; it exists to make the delta explicit until `PROGRAM_STATUS.md` is folded forward at the next governed status sync.

---

## Current truth

### Phase 1

Phase 1 is complete.

Closing commit: `66c9cc1`  
Scope closed:
- CFix-1 — scanner source contract + board-cap enforcement fix
- CFix-2 — market alias / key-format correction against live SGO keys
- CFix-3 — CLV trust / settlement wiring through normal promotion evaluation path

Runtime truth at closure:
- worker up
- scanner live after restart
- tests passing
- type-check clean
- repo clean

### Phase 2

Phase 2 is now staged in Linear and is the active next build.

Issues:
- UTV2-458 — Contract + schema spec for market universe and candidates
- UTV2-459 — Create `market_universe` table + migration
- UTV2-460 — Create `pick_candidates` table + migration
- UTV2-461 — Build market universe materializer from `provider_offers`
- UTV2-462 — Add line movement tracking derived from universe updates
- UTV2-463 — Build board scan framework to generate candidates
- UTV2-464 — Phase 2 runtime proof and evidence bundle

Current issue state:
- all Backlog
- nothing In Progress
- UTV2-458 is the only unblocked issue

Dependency locks:
- 458 first
- 459 and 460 blocked on 458
- 459 and 460 may be authored in parallel only after 458 closes
- 459 and 460 must merge serially because both are T1 migrations
- 461 waits on 459
- 462 waits on 459 + 461
- 463 waits on 460 + 461
- 464 is the hard gate to Phase 3

---

## Phase 2 contract decisions now locked

The authoritative contract for UTV2-458 now lives at:

`docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md`

Locked decisions:
- `market_universe` uniqueness is null-safe for nullable `provider_participant_id`
- `pick_candidates` uses one active row per `universe_id`
- `scan_run_id` is provenance, not unique identity
- `pick_candidates.pick_id` remains null for all of Phase 2
- `model_score`, `model_tier`, and `model_confidence` remain null for all of Phase 2
- materializer writes `market_universe` only
- board scan writes `pick_candidates` only
- scanner path remains parallel and unchanged in Phase 2
- Phase 3 stays blocked until UTV2-464 proof is accepted

---

## What remains blocked

Blocked until UTV2-458 closes:
- UTV2-459
- UTV2-460

Blocked until 459/460/461 prerequisites exist:
- UTV2-462
- UTV2-463

Blocked until UTV2-464 proof closes:
- all Phase 3 work

---

## Explicit non-claim

No Phase 2 runtime implementation has started in this update.

This repo action records contract truth and staging truth only. No migrations, materializer code, board-scan code, or candidate runtime writes are included here.
