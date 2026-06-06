<!-- merge_sha: 0d7f20285b26fd23f88f4a673ce1f931cb22ab30 -->

# Diff Summary: UTV2-1209 — Opponent Defensive Stats Mock Feed

**PR:** https://github.com/griff843/Unit-Talk-v2/pull/973
**Branch:** `claude/utv2-1209-opponent-defensive-stats-mock-feed`

## Files changed

### `packages/domain/src/features/efficiency.ts`

**Interfaces extended (backwards-compatible, all new fields optional):**
- `OpponentDefenseLog` — added `rating_date?: string` (ISO date when rating was computed)
- `OpponentDefenseInput` — added `stat_category?: string` (e.g. 'points', 'rebounds')
- New `EfficiencyConfig` interface with `reference_date?: string` and `max_age_days?: number`

**Function signature:**
- `extractEfficiencyFeatures(playerForm, defense, paceAdjustment=1.0, config={})` — 4th param added

**Max-age guard (new, UTV2-1209):**
- Activates only when both `reference_date` AND `max_age_days` are set
- Computes `cutoffDate = reference_date - max_age_days * 86400s`
- If `rating_date` absent → `{ ok: false, reason: "...no rating_date..." }`
- If `rating_date < cutoffDate` → `{ ok: false, reason: "...stale: rating_date=X < cutoff=Y..." }`
- Guard inactive (no-op) when either config field is absent

**Mock fixtures exported:**
- `MOCK_DEFENSE_FIXTURE` — fresh `rating_date: '2026-01-08'`, `stat_category: 'points'`
- `MOCK_DEFENSE_FIXTURE_STALE` — `rating_date: '2025-06-01'` (far past)
- `MOCK_DEFENSE_FIXTURE_NO_DATE` — no `rating_date` (missing provenance)

Names prefixed `MOCK_DEFENSE_*` to avoid collision with `opportunity.ts`'s `MOCK_FIXTURE` in the features barrel.

### `packages/domain/src/features/efficiency.test.ts`

Added 9 new tests covering: fixture validity, provenance fields, stale fail-closed, absent-date fail-closed, fresh-within-window pass, guard no-op cases (both partial), stat_category neutrality, reason string content.

### `.ops/sync/UTV2-1209.yml`

Per-issue sync file required by `ops:sync-check`. Maps branch `claude/utv2-1209-*` to issue `UTV2-1209` with proof paths declared.

## What was NOT changed

- No DB migrations
- No schema changes in `packages/contracts/`
- No SGO activation
- No P3 certification advancement
- P5 remains frozen
- No environment variable additions
