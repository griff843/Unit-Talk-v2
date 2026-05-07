# UTV2-848 Provenance Report

Generated: 2026-05-07T15:23:10.475Z
Evaluation window: 2026-04-07T15:23:10.475Z to 2026-05-07T15:23:10.475Z (30 days)
System verdict: FAIL - Model attribution is not resolvable for the required threshold, so trusted model-edge evaluation remains blocked.

| Metric | Value |
|---|---:|
| provenance_linked_pct | 99.95 |
| model_attributed_pct | 0 |
| candidate_linked_pct | 89.79 |
| market_universe_linked_pct | 89.79 |
| source_type_present_pct | 100 |
| source_separated_pct | 3.83 |
| shadow_pct | 0 |
| historical_unknown_pct | 0.05 |
| operator_edited_pct | 0 |
| excluded_from_model_edge_pct | 100 |

Top exclusion reasons:
- no_model_attribution: 4201
- source_ambiguous: 4040
- no_stake: 3810

Historical UNKNOWN count: 2

Provenance PASS does not mean the model has edge.

Runtime enforcement gap report:
- Hard fail: null/non-canonical source at ingestion or qualification, invalid stake_units at qualification, candidate conversion without universe_id.
- Quarantine: missing scan_run_id, submission-only rows, missing model_or_heuristic_id, and shadow_mode rows.
- Warn only: JSONB model hint that does not resolve, board candidate without scan_run_id, manual or heuristic source.
- Future lane: UTV2-850 remains the top blocker for resolvable model attribution.
