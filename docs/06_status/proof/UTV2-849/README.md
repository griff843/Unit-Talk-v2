# UTV2-849 Source-Separated Pick Ledger

Generated: 2026-05-07T18:20:24.518Z
Evaluation window: 2026-04-07T18:20:24.518Z to 2026-05-07T18:20:24.518Z (30 days)
System verdict: FAIL - No rows have resolvable model registry attribution; model-edge and syndicate samples remain fully blocked.

| Source class | Rows |
|---|---:|
| manual | 417 |
| heuristic | 3783 |
| model_generated | 0 |
| shadow | 0 |
| operator_edited | 0 |
| unsupported_market | 12 |
| replay | 0 |
| synthetic | 2 |
| imported_historical | 0 |
| UNKNOWN | 0 |

| Sample | Contaminated | Contamination % |
|---|---:|---:|
| model-edge | true | 100 |
| ROI | true | 0.05 |
| CLV | true | 9.97 |

Top exclusion reasons:
- legacy_source: 8517
- heuristic_source: 7566
- manual_source: 1215

Source separation PASS does not mean the model has edge.

Historical UNKNOWN rows are permanently classified as UNKNOWN. They are not reclassified as model_generated.

No scanner or board-construction population is upgraded to model_generated without a resolvable model_registry link.

Distinct raw sources observed: system-pick-scanner=3622, smart-form=386, board-construction=161, api=28, human=3, canary-proof=2
