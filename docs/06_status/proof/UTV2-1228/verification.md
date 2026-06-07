## UTV2-1228 Verification

**Issue:** Fix post-cutover sport_id NULL attribution for live picks/candidates  
**Branch:** claude/utv2-1228-sport-id-null-attribution  
**Tier:** T1  
**Executor:** Claude

---

## Root Cause

Two bugs in `packages/db/src/pick-foreign-keys.ts`:

**Bug 1 — Early-return gate blocks market-prefix fallback**  
`deriveSportId()` had `if (!marketTypeId) return null` before the market-string prefix checks. For SGO-format market keys like `nba-spread`, `nba-ml`, `nba-total`, `deriveMarketTypeId()` returns null (those keys were not in `ALTERNATE_MARKET_TYPE_IDS`). The early-return then prevented the market-prefix fallback (`normalizedMarket.startsWith('nba')` → 'NBA') from ever running.

**Bug 2 — normalizeSportId used toUpperCase() against a mixed-case set**  
`CANONICAL_SPORT_IDS` contains `'Soccer'` and `'Tennis'` (mixed case), but the check was `CANONICAL_SPORT_IDS.has(cleaned.toUpperCase())`. `'SOCCER'` and `'TENNIS'` are not in the set, so Soccer/Tennis picks with `metadata.sport = 'Soccer'` got `sport_id = NULL`.

**Corpus finding:** All 1,196 post-cutover NULL picks are synthetic test artifacts (`source = null`, `metadata = {}` or `{proof: true}` or `{testRun: '...'}`). No board-construction picks have been created post-cutover (last board run: 2026-05-20). The fix ensures correct attribution for all future board picks and correctly handles SGO-format market keys in test picks.

---

## Fix

- `deriveSportId()`: Removed the early-return guard; changed `marketTypeId.startsWith(...)` to `marketTypeId?.startsWith(...)` (optional chaining).
- `normalizeSportId()`: Changed to iterate the set with case-insensitive matching.
- `ALTERNATE_MARKET_TYPE_IDS`: Added 18 SGO-prefixed market key entries (nba-spread, nba-ml, nba-total, nfl-*, mlb-*, nhl-*, ncaab-*, ncaaf-*) → canonical market type IDs.

---

## Test Results

### pnpm verify (exit 0)
```
sync-check: OK
system-alignment: PASS fail=0 warn=0
automation-coverage: PASS fail=0 warn=0
env:check: PASS
lint: PASS
type-check: PASS
build: PASS
test: all test suites pass
```

### Unit tests — pick-foreign-keys.test.ts (12/12 pass)
```
ok 1 - derives sport, capper, and canonical player prop market type from smart form metadata
ok 2 - derives combo market types from stat type when canonical market type id is absent
ok 3 - derives game markets from compact smart form market metadata
ok 4 - derives game total market type from legacy smart-form totals alias
ok 5 - derives MLB stat market ids from stat type fallback
ok 6 - returns null market type for unknown manual metadata instead of inventing a FK
ok 7 - derives NBA from SGO-format market key nba-spread when metadata.sport is absent
ok 8 - derives NBA from SGO market key nba-ml
ok 9 - derives NBA from SGO market key nba-total
ok 10 - derives NFL from SGO market key nfl-spread when metadata.sport is absent
ok 11 - normalizeSportId handles Soccer and Tennis case-insensitively
ok 12 - deriveSportId falls back to market prefix even when deriveMarketTypeId returns null
# tests 12  pass 12  fail 0
```

### pnpm test:db (7/7 pass)
```
ok 1 - UTV2-217: submitted pick surfaces in DB within 5 seconds
ok 2 - UTV2-920: invalid atomic submission rolls back
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back
ok 4 - UTV2-920: invalid atomic settlement writes no settlement
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction
ok 7 - UTV2-996: correction chain is additive
# tests 7  pass 7  fail 0  duration_ms 132397
```

### R-level check
```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```
