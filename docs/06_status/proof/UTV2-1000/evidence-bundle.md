# UTV2-1000 Model Edge Proof Evidence Bundle

Generated: 2026-05-18T03:10:39.770Z

Source artifact: `artifacts/model-edge-proof.json`

Filter: `picks.promotion_status IS NOT NULL` with at least one `settlement_records` row.

## Sample Count Breakdown

| count | value |
| --- | ---: |
| Promoted pick rows read | 4,887 |
| Settlement rows read | 396 |
| Analyzed settled picks | 395 |
| Real-edge-backed settled picks | 5 |
| Confidence-proxy settled picks | 388 |
| Unknown edge-source settled picks | 2 |
| Historical settled picks | 391 |
| Post-fix settled picks after 2026-05-01 | 4 |

## Real-Edge vs Proxy Split

| edge split | sample | wins | losses | pushes | win rate | ROI | ROI 95% CI | CLV beat rate | median CLV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| real-edge-backed | 5 | 3 | 2 | 0 | 60.0% | 7.6% | -79.3% to 94.5% | n/a | n/a |
| confidence-proxy | 388 | 126 | 262 | 0 | 32.5% | -26.1% | -37.8% to -15.1% | 71.9% | 0.0240 |
| unknown | 2 | 2 | 0 | 0 | 100.0% | 167.5% | 35.2% to 299.8% | 100.0% | 0.0237 |

## ROI by Sport

| sport | sample | wins | losses | pushes | win rate | ROI | ROI 95% CI | CLV beat rate | median CLV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| MLB | 296 | 87 | 209 | 0 | 29.4% | -32.4% | -45.2% to -19.7% | 65.8% | 0.0210 |
| NBA | 66 | 31 | 35 | 0 | 47.0% | -8.8% | -32.2% to 15.9% | 87.9% | 0.0286 |
| NHL | 32 | 12 | 20 | 0 | 37.5% | 5.5% | -48.6% to 59.5% | 88.5% | 0.0239 |
| unknown | 1 | 1 | 0 | 0 | 100.0% | 90.8% | n/a | n/a | n/a |

## ROI, CLV, Win Rate by Band

| band | sample | wins | losses | pushes | win rate | ROI | ROI 95% CI | CLV beat rate | median CLV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| A+ | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a |
| A | 1 | 1 | 0 | 0 | 100.0% | 150.0% | n/a | n/a | n/a |
| B | 6 | 4 | 2 | 0 | 66.7% | 16.8% | -56.4% to 90.0% | n/a | n/a |
| C | 386 | 124 | 262 | 0 | 32.1% | -26.7% | -38.5% to -15.7% | 71.9% | 0.0240 |
| UNKNOWN | 2 | 2 | 0 | 0 | 100.0% | 167.5% | 35.2% to 299.8% | 100.0% | 0.0237 |

## Band Calibration

Higher bands cannot be proven as calibrated on this sample. A+ has zero settled rows, A has one row, B has six rows, and C has 386 rows. The observed A > B > C win-rate ordering is directionally higher where data exists, but the A and B samples are too small to treat as calibrated proof.

| band | sample | win rate |
| --- | ---: | ---: |
| A+ | 0 | n/a |
| A | 1 | 100.0% |
| B | 6 | 66.7% |
| C | 386 | 32.1% |

## Out-of-Sample Split

| era | sample | wins | losses | pushes | win rate | ROI | ROI 95% CI | CLV beat rate | median CLV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| historical | 391 | 128 | 263 | 0 | 32.7% | -25.5% | -36.8% to -14.1% | 71.8% | 0.0238 |
| post-fix after 2026-05-01 | 4 | 3 | 1 | 0 | 75.0% | 38.6% | -67.9% to 105.8% | 100.0% | 0.0944 |

## Final Verdict

Verdict: `INSUFFICIENT_DATA`

Reasoning: only 5 real-edge-backed settled picks were found. UTV2-1000 requires at least 50 real-edge-backed settled picks for any non-`INSUFFICIENT_DATA` verdict. The broader 395-pick settled sample is dominated by confidence-proxy rows, so it cannot prove real model edge.

If UTV2-997 produces a more refined canonical dataset, this proof can be re-run against that data.
