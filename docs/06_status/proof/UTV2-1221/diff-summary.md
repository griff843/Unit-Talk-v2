# Diff Summary — UTV2-1221
<!-- merge_sha: 9a7174f8110c41b1fba52e8d7829eef3728a6f30 -->

**Issue:** UTV2-1221 — Add `getTeamPreviousGameDate` helper to TeamScheduleRepository
**Tier:** T2
**Branch:** `claude/utv2-1221-get-team-previous-game-date`

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/runtime-repositories.ts` | Added `TeamScheduleRepository` interface, `InMemoryTeamScheduleRepository`, `DatabaseTeamScheduleRepository` |
| `packages/db/src/team-schedule-repository.test.ts` | New: 6 unit tests for InMemory implementation |
| `packages/db/package.json` | Added `test` script for discoverable test wiring |

## Change Description

Adds a new `TeamScheduleRepository` interface and two implementations:

- **`InMemoryTeamScheduleRepository`**: In-process implementation for testing. Seeds events via `.seed()`, returns the most recent completed/in-progress game date before a given cutoff.
- **`DatabaseTeamScheduleRepository`**: Production implementation querying `event_participants` and `events` tables to find the most recent game for a team before a given date.

## Method Signature

```typescript
interface TeamScheduleRepository {
  getTeamPreviousGameDate(teamId: string, beforeDate: string): Promise<string | null>;
}
```

Returns the most recent `event_date` (ISO date string) for a completed or in-progress game where the team was a participant, with `event_date < beforeDate`. Returns `null` if no prior game exists.

## No Schema Changes

This lane does NOT add any DB migrations. It queries existing `events` and `event_participants` tables using read-only selects.

## Downstream Use

UTV2-1208 will use `DatabaseTeamScheduleRepository.getTeamPreviousGameDate` to compute `days_since_last_game` for the opportunity features mock fixture and max-age guard.
