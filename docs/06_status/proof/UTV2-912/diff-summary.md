# Diff Summary — UTV2-912

**Issue:** market_type_id null rows causing candidate scoring quarantine
**Branch:** claude/utv2-912-market-type-id-null-fix
**Merge SHA:** 652b16e2a80873a05744fafdba9103b0a5e85315
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/671
**Merged:** 2026-05-15

---

## Change Description

Single migration file: `supabase/migrations/202605140001_utv2_912_market_type_id_alias_backfill.sql`

**Root cause:** `provider_market_aliases` table was missing 64 alias entries for SGO provider_market_key values, so `MarketUniverseMaterializer.aliasMap.get()` returned undefined for those markets, leaving `market_type_id = NULL` in `market_universe`. `CandidateScoringService.resolveScoringOwner` then returned `{kind:'missing', reason:'market_type_id_null'}`, quarantining those candidates.

**Fix: 3-step migration**
1. INSERT 43 `market_types` rows (ON CONFLICT DO NOTHING) — covers NHL 2p/3p, NHL regulation, MLB innings 2–8, novelty game markets, and player props (fga, 2pm/2pa, 3pa, fta, blocks_steals, pp_points, hits, faceoffs_won)
2. INSERT 64 `provider_market_aliases` rows (ON CONFLICT DO NOTHING) — 27 MLB, 16 NBA, 21 NHL SGO key mappings
3. UPDATE `market_universe` backfill: resolves 8,558 null market_type_id rows via COALESCE(sport-specific alias, sport-agnostic alias), with participant-forbidden guard excluding game_total_ou/1h_total_ou/2h_total_ou from rows where provider_participant_id IS NOT NULL

**Result:** 671 remaining null rows are correct (all MLB game_total_ou with non-null provider_participant_id — excluded by PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS)

## Files Changed

```
supabase/migrations/202605140001_utv2_912_market_type_id_alias_backfill.sql  +157 lines
```

No TypeScript source changes — pure data/alias backfill.
