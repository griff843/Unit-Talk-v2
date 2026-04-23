# Proof: UTV2-719 Team external_id standardization
MERGE_SHA: pending (branch: claude/utv2-719-team-external-id-fix)

## Live DB verification — 2026-04-23

Script: `scripts/verify-719.ts` run against live Supabase `zfzdnfwdarxucxtaojxm`

```
=== Team participants post-migration ===
total: 124 | null league: 0 | old format: 0 | new format: 124

Player→team join: 200 resolve ✓, 0 still broken ✗

Event→team join (50 events): 100 ✓, 0 ✗

=== Sample teams (new format) ===
  BROOKLYN_NETS_NBA [league=NBA]
  INDIANA_PACERS_NBA [league=NBA]
  PORTLAND_TRAIL_BLAZERS_NBA [league=NBA]
  CHICAGO_BULLS_NBA [league=NBA]
  MILWAUKEE_BUCKS_NBA [league=NBA]
```

## Assertions

- [x] 124/124 teams have new-format external_id (CITY_TEAM_SPORT)
- [x] 0 teams remain with old `team:SPORT:Nickname` format
- [x] 0 teams have NULL league (was 124)
- [x] 200/200 player→team joins resolve via external_id
- [x] 100/100 event→team joins resolve via home/away_team_external_id
- [x] Migration applied to live DB before PR merge
