<!-- merge_sha: placeholder-update-after-merge -->
# Diff Summary — UTV2-1208

**Issue:** UTV2-1208 — Wave 4: role_logs mock ingest pipeline with provenance tagging
**Tier:** T1
**Branch:** `claude/utv2-1208-opportunity-features-provenance`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/972

## Files Changed

| File | Change |
|------|--------|
| `packages/domain/src/features/opportunity.ts` | Added `player_id?` to `RoleLog`, `reference_date`/`max_age_hours` to `OpportunityConfig`, `snap_share_suppressed?` to `OpportunityFeatures`, staleness guard logic, `MOCK_FIXTURE` + `MOCK_FIXTURE_SNAP_SHARE` exports |
| `packages/domain/src/features/opportunity.test.ts` | Added 8 new tests: fixture, provenance flag, staleness fail-closed (4 cases) |

## Change Description

### `RoleLog` interface

Added `player_id?: string` — optional provenance tag for traceability. All `MOCK_FIXTURE` entries populate this field.

### `OpportunityConfig` interface

Added:
- `reference_date?: string` — ISO date as staleness reference point
- `max_age_hours?: number` — maximum age (in hours) relative to `reference_date`

Both must be set to activate the staleness guard. When active, role logs with `game_date` older than `reference_date - max_age_hours` are filtered out.

### `OpportunityFeatures` interface

Added `snap_share_suppressed?: boolean`:
- `true` when `usage_rate_source === 'snap_share'`
- `false` when `usage_rate_source === 'direct'`
- Optional (backwards-compatible with existing `OpportunityFeatures` literal objects)

### Staleness guard (fail-closed)

In `extractOpportunityFeatures`:
1. If `reference_date` + `max_age_hours` both provided, filter out stale logs
2. If all logs filtered → `ok: false` with `'All role logs filtered by staleness guard'` reason
3. If fewer than `min_games` remain after filter → `ok: false` (existing insufficient-logs check)
4. If guard not configured → no-op, all logs pass through (backwards-compatible)

### Mock fixtures

- `MOCK_FIXTURE` — 5 entries, all direct `usage_rate`, with `player_id: 'mock-player-1'`
- `MOCK_FIXTURE_SNAP_SHARE` — 3 entries, all `usage_rate: null`, forces snap_share fallback

## No Schema Changes

Pure domain computation. No DB migrations. No contracts modified.

## Constitutional constraints

- SGO: not activated
- P3 certification: not advanced
- P5: remains frozen
- All data: mock/fixture only

## Downstream dependency

Wave 5 Issue 13 (opportunity wiring) may now use `MOCK_FIXTURE` and `MOCK_FIXTURE_SNAP_SHARE` for integration testing.
