# UTV2-850 Champion Model Registry Proof

Generated: 2026-05-07T18:44:39.195Z
Evaluation window: 2026-04-07T18:44:39.195Z to 2026-05-07T18:44:39.195Z (30 days)
System verdict: FAIL - No evaluation-window picks resolve to model_registry ownership, so model-edge attribution remains blocked.

| Registry entity type | Count |
|---|---:|
| champion_model | 6 |
| challenger_model | 0 |
| shadow_model | 0 |
| heuristic_system | 0 |
| manual_strategy | 0 |
| disabled_model | 0 |
| retired_model | 0 |
| replay_model | 0 |
| synthetic_model | 0 |
| UNKNOWN | 0 |

Attribution coverage:
- Total picks analyzed: 4202
- Model attributed: 0 (0%)
- Heuristic owned: 90.03%
- Rows linked to candidates: 0
- Rows linked to picks: 0

Top attribution gaps:
- ALL: 4202 (missing_registry_fk_column)
- system-pick-scanner: 3622 (missing_registry_fk)
- smart-form: 386 (source_not_model_owned)

Registry PASS does not prove model edge.

0% model attribution at baseline - all scanner picks are heuristic_system until pick_candidates.model_registry_id FK is established.

Current production picks are not truly model_generated because no pick or candidate row resolves to a registry owner. Registry entries exist, but ownership is not persisted at candidate scoring time.
