# Model Registry Audit

**Date:** 2026-05-11  
**Issue:** UTV2-890  
**Auditor:** Claude (orchestrator)  
**Data range:** 2026-04-21 – 2026-05-10 (30 days)  
**Sample:** 6 registry entries (all rows), 19,792 pick_candidates, 4,340 picks

---

## Summary Verdict

**The model registry is a scaffold, not a production system.** All 6 champion models are provisional baselines seeded on 2026-04-22 to unblock the scoring pipeline. None have validation metrics, formal promotion approval, or trained signal weights. NFL has zero coverage. 98.2% of pick_candidates are not linked to any registry entry.

| Finding | Status |
|---|---|
| Total champion entries | 6 |
| All entries are provisional placeholders | Yes — `metadata.provisional = true` for all |
| Validation metrics present | None — `validation_metrics = null` for all 6 |
| Formal promotion approval | None — `promotion_approved_by = null` for all 6 |
| NFL coverage | **Zero** — no registry entries for any NFL market |
| pick_candidates linked to registry | 356 / 19,792 (1.8%) |
| Champion used in real scoring decisions | Effectively no — placeholder weights only |

---

## Champion Entries

| Sport | Market Family | Model Name | Version | Champion Since | Provisional | validation_metrics | approved_by |
|---|---|---|---|---|---|---|---|
| MLB | game_line | baseline-mlb-game-line | v0.1-baseline-2026-04-22 | 2026-04-22 | **true** | null | null |
| MLB | player_prop | baseline-mlb-player-prop | v0.1-baseline-2026-04-22 | 2026-04-22 | **true** | null | null |
| NBA | game_line | baseline-nba-game-line | v0.1-baseline-2026-04-22 | 2026-04-22 | **true** | null | null |
| NBA | player_prop | baseline-nba-player-prop | v0.1-baseline-2026-04-22 | 2026-04-22 | **true** | null | null |
| NHL | game_line | baseline-nhl-game-line | v0.1-baseline-2026-04-22 | 2026-04-28 | **true** | null | null |
| NHL | player_prop | baseline-nhl-player-prop | v0.1-baseline-2026-04-22 | 2026-04-22 | **true** | null | null |

**Every champion has:**
- `sharp_weight: 0`, `movement_weight: 0` — no signal weighting  
- `calibration_metadata: null` — no calibration data  
- `note: "Baseline champion to unblock scoring pipeline. Replace with trained model when available."`  
- `source_type_compatibility: ["board-construction"]` — only board-construction picks; capper and model-driven sources have no compatible champion

---

## Coverage Gaps

### NFL — Complete Absence

The ingestor supports 4 leagues: NBA, MLB, NHL, NFL (hardcoded in `ingestor-runner.ts`). NFL has zero model_registry entries. There are no NFL picks in the 30-day window (consistent with off-season), but no champion is registered for NFL game_line or player_prop when the season resumes.

**Gap:** 2 missing entries — `NFL/game_line`, `NFL/player_prop`

### Capper and Model-Driven Sources

`source_type_compatibility` is `["board-construction"]` for all 6 entries. Picks from capper or model-driven sources have no registered champion. The `findChampion(sport, marketFamily, sourceType)` call will return null for non-board-construction source types.

---

## Infrastructure Assessment

The registry infrastructure IS correctly wired:

- `apps/api/src/candidate-scoring-service.ts` calls `this.repos.modelRegistry.findChampion(sport, marketFamily, sourceType)` (line 566)
- On match, sets `model_registry_id: champion.id` on the pick_candidate (line 323)
- `apps/api/src/index.ts` passes `modelRegistry` to scoring deps when it exists in `runtime.repositories` (line 142)

**However:** Only 356 of 19,792 pick_candidates (1.8%) have a `model_registry_id` set. This indicates the champion lookup is returning null for 98.2% of candidates — consistent with the `source_type_compatibility` gap and possibly with `marketFamily` not being resolved for most candidates.

---

## What the Registry Does Not Yet Do

| Capability | Present | Notes |
|---|---|---|
| Champion tracking (schema) | Yes | Schema exists with all required columns |
| Champion seeding | Yes | 6 provisional baselines |
| Scoring linkage | Yes (wired) | `candidateScoringService` writes `model_registry_id` |
| Trained/validated models | **No** | All placeholders, `validation_metrics = null` |
| Formal promotion approval | **No** | `promotion_approved_by = null` for all |
| NFL coverage | **No** | Zero entries |
| Capper/model-driven coverage | **No** | `source_type_compatibility` is board-construction only |
| Champion vs challenger framework | **No** | Only champion status exists; no challenger lifecycle |
| Pick-level model attribution | **No** | `picks.metadata` has no model reference — only `pick_candidates.model_registry_id` |

---

## Root Cause of Low Linkage Rate (1.8%)

`findChampion(sport, marketFamily, sourceType)` requires:
1. `sport` — derivable from pick candidate
2. `marketFamily` — requires market key → family mapping to be resolved
3. `sourceType` — must match `source_type_compatibility` array

All 6 champions are `source_type_compatibility: ["board-construction"]`. Pick candidates from other source types will never match. Additionally, if `marketFamily` cannot be resolved from the candidate's market key, the lookup is skipped (line 554: `if (!this.repos.modelRegistry || !marketFamily) { return; }`).

This is a secondary wiring gap distinct from the placeholder model quality issue.

---

## Conclusion

The model registry is a well-designed scaffold with correct infrastructure but placeholder content. The system cannot make evidence-based champion selections today because:

1. All champions are `provisional: true` with zero training signal (`sharp_weight: 0`, `movement_weight: 0`)
2. No validation metrics exist for any champion
3. No formal promotion approval was recorded for any champion
4. NFL has no coverage for when the season resumes
5. 98.2% of pick_candidates are not being linked to the registry (source_type and/or market_family resolution gap)

The registry will become meaningful when the model edge proof program (UTV2-891/892/893 CLV analysis, UTV2-895 MLB production readiness proof) produces validated metrics that can replace the provisional baseline entries.

---

## New Issues Required

| Finding | Priority | Action |
|---|---|---|
| NFL champion entries missing | Medium | Register NFL game_line + player_prop baseline champions before NFL season (Sept 2026) |
| All champions are provisional placeholders | High | Model edge proof program (UTV2-891–896) is the path to replace provisional champions with validated ones |
| pick_candidates source_type linkage gap (98.2% unlinked) | Medium | Investigate: extend `source_type_compatibility` to include capper + model-driven, or fix marketFamily resolution |
| Pick-level model attribution absent | Low | `picks.metadata` has no model reference — only `pick_candidates.model_registry_id` |

---

## Next Steps

1. The model edge proof program (UTV2-891/892/893/895/896) is the correct path to replace provisional champions with trained, validated models. This audit unblocks nothing new — it confirms that the registry is the right surface and the proof program is the right action.
2. NFL baseline champions should be seeded before NFL season (September 2026) — low urgency now.
3. The source_type linkage gap (98.2% unlinked) should be investigated as a separate issue — this is a wiring gap that prevents the registry from being used effectively even for provisional models.
