# System Check: Pipeline

Generated: 2026-04-27T00:06:32.699Z
Mode: read-only
Counting strategy: supabase_estimated_count

## Today

Since: 2026-04-26T04:00:00.000Z

| Count | Value |
|---|---:|
| provider_offers | 1948074 |
| market_universe_rows_refreshed | 4199 |
| pick_candidates_created | 3057 |
| pick_candidates_scored | 3366 |
| qualified_candidates | 1001 |
| candidates_with_pick_id | 1997 |
| picks_created_by_system_pick_scanner | 1181 |
| picks_in_awaiting_approval | 0 |
| posted_picks | 5 |
| settled_picks | 0 |
| clv_backed_settlements | 0 |
| pnl_populated_settlements | 0 |
| posted_system_picks_without_result | 5 |
| posted_system_picks_missing_event | 0 |
| posted_system_picks_missing_participant | 5 |
| posted_system_picks_missing_market_type | 0 |
| posted_system_picks_with_game_result | 0 |

Diagnosis: Posted system-pick-scanner picks are not settlement-eligible: unsupported_market_family=5.

Top suspected blockers:
- Settlement/grading path: posted system-pick-scanner picks exist but none settled in the window.

Posted system-pick grading skip reasons:
- unsupported_market_family: 5

Posted system-pick samples:
| Pick | Market | Type | Line | Event | Participant | Game Results | Settlement | Skip Reason |
|---|---|---|---:|---|---|---:|---:|---|
| 8e2459ab-48cd-41e9-bbb6-bc8f1ce0a668 | moneyline | f5_moneyline |  | 32953be4-cce5-4a16-8070-279e4cf357f6 |  | 0 | 0 | unsupported_market_family |
| fb1d922a-39ff-40dc-8366-8d90ec91eab7 | moneyline | f3_moneyline |  | f7a81817-6059-421f-8d72-7803104cb499 |  | 0 | 0 | unsupported_market_family |
| fde86531-43cc-46ea-95a5-ea0fd71908f4 | moneyline | f3_moneyline |  | 7062a0b2-42b4-43cc-a8ca-ffcca3e833ac |  | 0 | 0 | unsupported_market_family |
| 10819f1b-feda-4223-b25a-0272d85d9a06 | moneyline | f3_moneyline |  | 05b43209-5f8b-4879-a65f-bf555e61294d |  | 0 | 0 | unsupported_market_family |
| 1d02f53e-6bf8-4aba-86d7-443b256a797a | moneyline | f3_moneyline |  | 32953be4-cce5-4a16-8070-279e4cf357f6 |  | 0 | 0 | unsupported_market_family |

## Last 24h

Since: 2026-04-26T00:06:32.699Z

| Count | Value |
|---|---:|
| provider_offers | 2402611 |
| market_universe_rows_refreshed | 4560 |
| pick_candidates_created | 4401 |
| pick_candidates_scored | 3366 |
| qualified_candidates | 1101 |
| candidates_with_pick_id | 1997 |
| picks_created_by_system_pick_scanner | 1475 |
| picks_in_awaiting_approval | 0 |
| posted_picks | 5 |
| settled_picks | 0 |
| clv_backed_settlements | 0 |
| pnl_populated_settlements | 0 |
| posted_system_picks_without_result | 5 |
| posted_system_picks_missing_event | 0 |
| posted_system_picks_missing_participant | 5 |
| posted_system_picks_missing_market_type | 0 |
| posted_system_picks_with_game_result | 0 |

Diagnosis: Posted system-pick-scanner picks are not settlement-eligible: unsupported_market_family=5.

Top suspected blockers:
- Settlement/grading path: posted system-pick-scanner picks exist but none settled in the window.

Posted system-pick grading skip reasons:
- unsupported_market_family: 5

Posted system-pick samples:
| Pick | Market | Type | Line | Event | Participant | Game Results | Settlement | Skip Reason |
|---|---|---|---:|---|---|---:|---:|---|
| 8e2459ab-48cd-41e9-bbb6-bc8f1ce0a668 | moneyline | f5_moneyline |  | 32953be4-cce5-4a16-8070-279e4cf357f6 |  | 0 | 0 | unsupported_market_family |
| fb1d922a-39ff-40dc-8366-8d90ec91eab7 | moneyline | f3_moneyline |  | f7a81817-6059-421f-8d72-7803104cb499 |  | 0 | 0 | unsupported_market_family |
| fde86531-43cc-46ea-95a5-ea0fd71908f4 | moneyline | f3_moneyline |  | 7062a0b2-42b4-43cc-a8ca-ffcca3e833ac |  | 0 | 0 | unsupported_market_family |
| 10819f1b-feda-4223-b25a-0272d85d9a06 | moneyline | f3_moneyline |  | 05b43209-5f8b-4879-a65f-bf555e61294d |  | 0 | 0 | unsupported_market_family |
| 1d02f53e-6bf8-4aba-86d7-443b256a797a | moneyline | f3_moneyline |  | 32953be4-cce5-4a16-8070-279e4cf357f6 |  | 0 | 0 | unsupported_market_family |

## Definitions

- provider_offers: provider_offers rows with snapshot_at in the window.
- market_universe_rows_refreshed: market_universe rows with refreshed_at in the window.
- pick_candidates_created: pick_candidates rows with created_at in the window.
- pick_candidates_scored: pick_candidates rows with model_score present and updated_at in the window.
- qualified_candidates: pick_candidates rows with status='qualified' and created_at in the window.
- candidates_with_pick_id: pick_candidates rows with pick_id present and updated_at in the window.
- picks_created_by_system_pick_scanner: picks rows with source='system-pick-scanner' and created_at in the window.
- picks_in_awaiting_approval: picks rows with source='system-pick-scanner', status='awaiting_approval', and created_at in the window.
- posted_picks: picks rows with source='system-pick-scanner', status='posted', and posted_at in the window.
- settled_picks: picks rows with source='system-pick-scanner', status='settled', and settled_at in the window.
- clv_backed_settlements: settlement_records rows settled in the window for system-pick-scanner picks whose payload includes clvRaw, clvPercent, or beatsClosingLine.
- pnl_populated_settlements: settlement_records rows settled in the window for system-pick-scanner picks whose payload includes profitLossUnits.
- posted_system_picks_without_result: Exact count of posted system-pick-scanner picks in the window with no matching game_results row.
- posted_system_picks_missing_event: Exact count of posted system-pick-scanner picks in the window without a resolvable event id from metadata or market_universe.
- posted_system_picks_missing_participant: Exact count of posted system-pick-scanner picks in the window without a pick, metadata, or market_universe participant id.
- posted_system_picks_missing_market_type: Exact count of posted system-pick-scanner picks in the window without a pick, metadata, or market_universe market_type_id.
- posted_system_picks_with_game_result: Exact count of posted system-pick-scanner picks in the window with a matching game_results row.

## Suggested Linear Issue Text

Title: Investigate system pick pipeline drop-off: Posted system-pick-scanner picks are not settlement-eligible: unsupported_market_family=5.

## Problem
The read-only pipeline audit shows a system-generated pick funnel drop-off.

## Last 24h counts
- provider_offers: 2402611
- market_universe_rows_refreshed: 4560
- pick_candidates_created: 4401
- pick_candidates_scored: 3366
- qualified_candidates: 1101
- candidates_with_pick_id: 1997
- picks_created_by_system_pick_scanner: 1475
- picks_in_awaiting_approval: 0
- posted_picks: 5
- settled_picks: 0
- clv_backed_settlements: 0
- pnl_populated_settlements: 0
- posted_system_picks_without_result: 5
- posted_system_picks_missing_event: 0
- posted_system_picks_missing_participant: 5
- posted_system_picks_missing_market_type: 0
- posted_system_picks_with_game_result: 0

## Diagnosis
Posted system-pick-scanner picks are not settlement-eligible: unsupported_market_family=5.

## Top suspected blockers
- Settlement/grading path: posted system-pick-scanner picks exist but none settled in the window.

## Acceptance criteria
- Identify the first failing service/path in the system-generated pick pipeline.
- Add or update focused node:test coverage for the failing path.
- Keep DB writes scoped to the actual runtime fix; do not create proof picks unless explicitly required.
- Run pnpm verify before PR.
