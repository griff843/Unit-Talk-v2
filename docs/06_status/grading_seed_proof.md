# Grading Seed Proof — UTV2-37

> **Issue:** UTV2-37 T3 Augment — SGO Results Live Proof Seed
> **Date:** 2026-03-26
> **Branch:** `augment/UTV2-37-sgo-results-seed-proof`
> **Prerequisite:** Migration 012 (`game_results` table) — confirmed applied (UTV2-28 DONE ✅)

---

## AC-1 — `--help` prints usage and exits 0

**Command:**
```
pnpm exec tsx scripts/seed-game-result.ts --help
```

**Output:**
```
Usage:
  pnpm exec tsx scripts/seed-game-result.ts \
    --event-id <event-external-id> \
    --market-key <market-key> \
    --actual-value <number> \
    [--participant-external-id <participant-external-id>]

Required:
  --event-id                   External ID of the event (events.external_id)
  --market-key                 Market key, e.g. points-all-game-ou
  --actual-value               Numeric result value

Optional:
  --participant-external-id    External ID of the participant (participants.external_id)
  --help                       Print this usage and exit

Example:
  pnpm exec tsx scripts/seed-game-result.ts \
    --event-id sgo-event-abc123 --market-key points-all-game-ou --actual-value 25
```

**Exit code:** 0 ✅

---

## AC-2 + AC-3 — Seed script inserts `game_results` row

**Event selected from live DB:**

| Field | Value |
|---|---|
| `events.external_id` | `31k67xO0pPW7ByjpFKy3` |
| `events.event_name` | Orlando Magic vs. Charlotte Hornets |
| `events.event_date` | 2026-03-19 |
| `events.status` | completed |

**Participant:**

| Field | Value |
|---|---|
| `participants.external_id` | `BRANDON_MILLER_1_NBA` |
| `participants.display_name` | Brandon Miller |

**Command run:**
```
pnpm exec tsx scripts/seed-game-result.ts \
  --event-id 31k67xO0pPW7ByjpFKy3 \
  --market-key points-all-game-ou \
  --actual-value 25 \
  --participant-external-id BRANDON_MILLER_1_NBA
```

**Script output:**
```
OK  game_results row inserted
    id             = 398d34b4-2d78-4716-a677-bd2bd6656275
    event_id       = 66874c70-6632-4474-b0a3-13bf84d87712
    participant_id = 71dea447-01d6-4629-b945-1af6ae6a6c8e
    market_key     = points-all-game-ou
    actual_value   = 25
    source         = manual
    sourced_at     = 2026-03-26T20:41:22.286Z
```

**Exit code:** 0 ✅

---

## DB Confirmation

| Field | Value |
|---|---|
| `game_results.id` | `398d34b4-2d78-4716-a677-bd2bd6656275` |
| `game_results.event_id` | `66874c70-6632-4474-b0a3-13bf84d87712` |
| `game_results.participant_id` | `71dea447-01d6-4629-b945-1af6ae6a6c8e` |
| `game_results.market_key` | `points-all-game-ou` |
| `game_results.actual_value` | `25` |
| `game_results.source` | `manual` |
| `game_results.sourced_at` | `2026-03-26T20:41:22.286Z` |

Row confirmed present in `game_results` table (Supabase project `feownrheeefbcsehtsiw`).

---

## Notes

- Migration 012 was applied as part of UTV2-28 (T1 Automated Grading). Confirmed in `supabase migration list --linked`.
- The `UNIQUE (event_id, participant_id, market_key, source)` constraint on `game_results` prevents duplicate inserts. Running the same command twice would return a 23505 conflict error and not add a duplicate row.
- The ingestor (UTV2-42, lane:augment) has already populated `game_results` with 1,990 rows (`source: sgo`) from 10 completed NBA games. This seed adds one additional `source: manual` row for explicit proof purposes.
- `pnpm type-check` exits 0 for `scripts/seed-game-result.ts`.
