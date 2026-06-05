# UTV2-1210 — Schedule / Back-to-Back Data Availability Audit

**Verdict: PARTIAL**

Wave 3 Issue 6 (UTV2-1205) merged as prerequisite.

---

## Summary

The domain type contract for schedule/back-to-back data is fully defined and the computation logic is implemented. Two of three required data fields (`game_date`, `is_home`) are available from the existing DB schema. The third field (`prev_game_date`) is not stored directly — it must be derived from the `events` table by querying the most recent prior event for the same team. No canonical repository method exists for this derivation.

---

## Data Fields Required by `extractGameContextFeatures`

From `packages/domain/src/features/game-context.ts:30-37`:

```typescript
export interface GameScheduleData {
  game_date: string;        // Date of this game (ISO string)
  prev_game_date: string | null;  // Date of team's previous game
  is_home: boolean;         // Is the team playing at home?
}
```

---

## Field-by-Field Audit

### `game_date` — **EXISTING**

- **Source:** `public.events.event_date` (timestamptz)
- **Migration:** `supabase/migrations/202603200008_reference_data_foundation.sql:76`
- **Table:** `public.events(id, event_date, status, sport_id, external_id, metadata)`
- **Access pattern:** `SELECT event_date FROM events WHERE id = $event_id`
- No additional work required.

### `is_home` — **EXISTING**

- **Source:** `public.event_participants.role` — value `'home'` or `'away'`
- **Migration:** `supabase/migrations/202603200008_reference_data_foundation.sql:93`
- **Table:** `public.event_participants(event_id, participant_id, role)`
- **Access pattern:**
  ```sql
  SELECT role = 'home' AS is_home
  FROM event_participants
  WHERE event_id = $event_id AND participant_id = $team_id
  ```
- No additional work required.

### `prev_game_date` — **PARTIAL** (derivable, no helper exists)

- **Not stored directly.** No `game_logs`, `team_schedule`, `player_game_logs`, or equivalent table exists in any migration.
- **Derivable from `events` + `event_participants`:**
  ```sql
  SELECT e.event_date
  FROM events e
  JOIN event_participants ep ON ep.event_id = e.id
  WHERE ep.participant_id = $team_id
    AND e.event_date < $game_date
    AND e.status IN ('completed', 'in_progress')
  ORDER BY e.event_date DESC
  LIMIT 1
  ```
- **Gap:** No repository method or helper wraps this derivation.  
  `packages/db/src/runtime-repositories.ts` has no `getTeamPreviousGameDate` or equivalent.  
  `packages/domain/src/features/game-context.ts` accepts `prev_game_date | null` and defaults to 2 rest days if null (line 109).

---

## Game Logs (`game_logs`) — **MISSING**

No `game_logs` table exists in any migration. The `GameLog` interface defined in:

`packages/domain/src/features/player-form.ts:14-21`:
```typescript
export interface GameLog {
  game_date: string;
  minutes: number;
  stat_value: number;
  usage_rate?: number;
  started: boolean;
}
```

...has no DB backing. UTV2-1207 (Wave 4 game_logs mock pipeline) implements mock/fixture data for this field as a prerequisite for Wave 5 Issue 12.

---

## Code Path — Back-to-Back Computation

Already implemented in `packages/domain/src/features/game-context.ts:109-116`:

```typescript
let restDays = 2; // default if unknown
if (schedule.prev_game_date) {
  const current = new Date(schedule.game_date);
  const prev = new Date(schedule.prev_game_date);
  const diffMs = current.getTime() - prev.getTime();
  restDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}
const isBackToBack = restDays <= 1;
```

The domain extractor handles null `prev_game_date` gracefully (defaults to 2 rest days). **No changes to game-context.ts are needed.**

---

## Verdict: PARTIAL

| Field | Status | Source |
|-------|--------|--------|
| `game_date` | EXISTING | `events.event_date` |
| `is_home` | EXISTING | `event_participants.role` |
| `prev_game_date` | PARTIAL | Derivable from `events` via SQL; no repository helper |
| `game_logs` (for player-form) | MISSING | No DB table; UTV2-1207 provides mock fixture |

### What is needed before Wave 5 Issue 15 (game-context wiring) can start

1. **`prev_game_date` helper** — Add a repository method `getTeamPreviousGameDate(teamId, beforeDate)` to `packages/db/src/runtime-repositories.ts` that executes the derivation query above. This is a new feed implementation required as a separate issue before Wave 5 Issue 15 starts.

2. **Game logs** — Covered by UTV2-1207 (mock fixture pipeline). Wave 5 Issue 12 depends on that merge.

### Recommended next steps

- Create a new Wave 4 issue for the `prev_game_date` repository helper (separate from UTV2-1207 scope).
- UTV2-1207 (game_logs mock) proceeds independently — no conflict.
- Wave 5 Issues 1211 and 1215 must wait for both: this verdict + the new repository helper issue.

---

## File References

| File | Purpose | Relevant Lines |
|------|---------|----------------|
| `packages/domain/src/features/game-context.ts` | `GameScheduleData` type + `extractGameContextFeatures` | 30-37, 109-116 |
| `packages/domain/src/features/player-form.ts` | `GameLog` type + `extractPlayerFormFeatures` | 14-21, 71-73 |
| `supabase/migrations/202603200008_reference_data_foundation.sql` | `events` + `event_participants` tables | 76-100 |
| `packages/db/src/runtime-repositories.ts` | Missing: no `getTeamPreviousGameDate` helper | — |
