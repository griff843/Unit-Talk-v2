# V1 Data Extraction Audit

**Status:** Ratified 2026-03-31
**Issue:** UTV2-172
**Authority:** Prerequisite for shadow validation execution (SHADOW_VALIDATION_PLAN.md section 4.1)

---

## 1. Summary

V1 (unit-talk-production) uses **Supabase PostgreSQL** — the same infrastructure as V2. All comparison surfaces have structured, queryable data. Shadow validation can use **direct Supabase queries** against V1's database for extraction.

**Key finding:** Both V1 and V2 share the same Supabase project infrastructure. Comparison scripts can query both databases from the same script using different Supabase clients.

---

## 2. V1 Database Access

| Field | Value |
|-------|-------|
| Database | Supabase PostgreSQL (cloud) |
| Client | `@supabase/supabase-js` |
| Auth | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from V1's `local.env` |
| Type source | `apps/api/src/types/supabase-types.ts` (V1 repo) |

---

## 3. Surface-by-Surface Extraction Map

### 3.1 Picks / Submissions

| Aspect | V1 | V2 |
|--------|----|----|
| Table | `unified_picks` | `picks` |
| Capper field | `user_id` | `submitted_by` (from `submissions`) |
| Status field | `status` + `settlement_status` | `status` (lifecycle state) |
| Odds field | `odds` (American) | `odds` (American) |
| Line field | `line` | `line` |
| Market field | `market_type` + `stat_type` | `market` (normalized via `normalizeMarketKey()`) |
| Selection field | `prediction` / bet_side in `prop_settlements` | `selection` |
| Sport field | `sport` | `metadata.sport` |
| Confidence | `confidence` (0-1) | `metadata.capperConviction` (1-10) |
| Match key | `user_id + sport + player_name + stat_type + line + prediction` | `submitted_by + sport + participant + market + line + selection` |

**Extraction query (V1):**
```sql
SELECT id, user_id, sport, player_name, stat_type, line, prediction,
       odds, units, status, settlement_status, settlement_result,
       professional_score, tier, published, created_at, settled_at
FROM unified_picks
WHERE settled_at IS NOT NULL
ORDER BY settled_at DESC;
```

### 3.2 Grading / Settlement

| Aspect | V1 | V2 |
|--------|----|----|
| Grading table | `prop_settlements` | `settlement_records` |
| Outcome field | `settlement_result` (win/loss/push/void) | `result` (win/loss/push) |
| Actual value | `actual_value` | fetched from `game_results.actual_value` |
| Grading logic | SQL function `calculate_bet_result(line, actual_value, bet_side)` | `resolveOutcome(actual_value, line)` in grading-service.ts |
| OVER/UNDER | `bet_side` column | Inferred from `selection` regex |
| Game results table | `game_results` | `game_results` |
| Settlement method | `settlement_method` (automatic/manual) | `source` (grading/manual) |

**Grading logic parity:** Both use the same deterministic rule:
- OVER: actual > line = WIN, actual < line = LOSS, actual = line = PUSH
- UNDER: actual < line = WIN, actual > line = LOSS, actual = line = PUSH

**Extraction query (V1):**
```sql
SELECT ps.id, ps.player_name, ps.stat_type, ps.line, ps.bet_side,
       ps.actual_value, ps.settlement_result, ps.settled_at,
       gr.sport, gr.home_team, gr.away_team, gr.status as game_status
FROM prop_settlements ps
JOIN game_results gr ON ps.game_result_id = gr.id
WHERE ps.settlement_result IN ('win', 'loss', 'push')
ORDER BY ps.settled_at DESC;
```

### 3.3 CLV Computation

| Aspect | V1 | V2 |
|--------|----|----|
| CLV table | `clv_tracking` + `clv_results` | `settlement_records` (inline fields) |
| Raw CLV | `clv_tracking.clv` | `settlement_records.clvRaw` |
| CLV percent | `clv_tracking.clv_percentage` | `settlement_records.clvPercent` |
| Beats closing | `clv_tracking.beats_closing` | `settlement_records.beatsClosingLine` |
| Devig method | `devigged_opening_prob`, `devigged_closing_prob` | Proportional devig in `@unit-talk/domain` |
| Computation | `CLVComputeService.ts` — `clv_prob = p_close - p_entry` | `computeAndAttachCLV()` in `clv-service.ts` |

**Known divergence risk:** V1 may use a different devig method or different close-time snapshot. This should be classified as `KNOWN_DIV` if devig algorithms differ, not as a bug.

**Extraction query (V1):**
```sql
SELECT ct.prop_id, ct.clv, ct.clv_percentage, ct.beats_closing,
       ct.devigged_opening_prob, ct.devigged_closing_prob,
       ct.bet_odds, ct.closing_odds, ct.actual_result
FROM clv_tracking ct
WHERE ct.clv IS NOT NULL
ORDER BY ct.bet_time DESC;
```

### 3.4 Promotion / Scoring

| Aspect | V1 | V2 |
|--------|----|----|
| Scoring | `professional_score` (0-100) + `tier` (S/A/B/C/F) | `promotionScores` (edge/trust/readiness/uniqueness/boardFit) composite |
| Gate logic | `PromotionGatekeeper.ts` — rule-based with EV, steam, risk, timing checks | `evaluateAndPersistBestBetsPromotion()` — weighted composite score |
| Promotion record | `unified_picks.published` (boolean) | `pick_promotion_history` (per-policy, structured) |
| Channel routing | Tier-based (S-tier → `#picks-s-tier`, etc.) | Policy-based (best-bets, trader-insights, exclusive-insights) |

**Comparison mode:** Informational only, not blocking. V2 promotion model is intentionally redesigned. Compare promotion *rates* (% of picks promoted), not individual decisions.

### 3.5 Stats Aggregation

| Aspect | V1 | V2 |
|--------|----|----|
| Computation | `RollingMetricsService.ts` — derived from `unified_picks` | `buildCapperStatsResponse()` — derived from `settlement_records` + `picks` |
| Win rate | `hitPercentage` | `winRate` |
| ROI | `roi` (by tier, by sport) | `roiPct` (flat bet) |
| CLV stat | `averageCLV`, `positiveCLVPercentage` | `avgClvPct` |
| Windows | 7d, 30d, lifetime | 7d, 14d, 30d, 90d |

**Comparison approach:** Query both systems for same capper + same window. Compare counts and rates.

### 3.6 Recap

| Aspect | V1 | V2 |
|--------|----|----|
| Service | `RecapAgent/recapService.ts` | `recap-service.ts` |
| Output | `RecapSummary` (totalPicks, wins, losses, pushes, winRate, netUnits, roi) | `RecapSummary` (record, netUnits, roiPct, topPlay) |
| Schedule | Agent-driven | Scheduler at 11:00 UTC |
| Destination | Discord `#daily-recap` + Notion | Discord `discord:recaps` |

**Comparison approach:** Compare daily aggregates (record, net units, ROI) for overlapping dates.

### 3.7 Discord Delivery

| Aspect | V1 | V2 |
|--------|----|----|
| Tracking table | `discord_outbox` | `distribution_outbox` + `distribution_receipts` |
| Channel routing | Tier-based (S/A/B channels) | Target-based (best-bets, trader-insights, etc.) |
| Message tracking | `discord_message_id` in outbox | `external_id` in receipts |

**Comparison mode:** Channel mapping is intentionally different. Compare: did the same pick get posted to *any* Discord channel in both systems?

### 3.8 Game Results / Odds

| Aspect | V1 | V2 |
|--------|----|----|
| Primary source | Odds API + Optimal API | SGO API |
| Results table | `game_results` + `canonical_events` | `game_results` |
| Offers table | `provider_offers` | `provider_offers` |
| Event resolution | `canonical_events` with participant mapping | `events` + `event_participants` |

**Critical input alignment issue:** V1 and V2 may use **different odds providers** (Odds API vs SGO). Game results (`actual_value`) should still match for the same game, but closing line odds may differ. CLV parity comparison must account for this.

---

## 4. Historical Overlap Assessment

### Overlap period determination

V2 has been live since approximately 2026-03-20 (first migrations applied). V1 was still operational during this period.

**To determine exact overlap:** Query both databases for picks with overlapping `created_at` ranges:

```sql
-- V1: latest activity
SELECT MAX(created_at) as last_v1_pick FROM unified_picks;

-- V2: earliest activity
SELECT MIN(created_at) as first_v2_pick FROM picks;
```

If overlap exists (V1 picks created after V2's first pick), historical overlap comparison is viable.

If no overlap exists, replay mode is required (feed V1 historical picks through V2 grading logic).

### Recommended comparison strategy

**Historical overlap comparison** is the preferred strategy because:
1. Both systems use Supabase — extraction is trivial
2. Same SQL query patterns work against both
3. No replay harness needs to be built

**Prerequisite action:** Run the overlap queries above to confirm dates before writing comparison scripts.

---

## 5. Comparison Script Requirements

Based on this audit, each comparison script needs:

1. **Two Supabase clients** — one for V1, one for V2 (different URLs/keys)
2. **Match key resolution** — V1 `user_id + player_name + stat_type + line + prediction` maps to V2 `submitted_by + participant + market + line + selection`
3. **Field mapping** — translate V1 field names to V2 equivalents (see tables above)
4. **Provider divergence handling** — CLV comparison must flag different odds sources as `KNOWN_DIV`

### Environment variables needed

```
V1_SUPABASE_URL=<V1 project URL>
V1_SUPABASE_SERVICE_ROLE_KEY=<V1 service role key>
V2_SUPABASE_URL=<V2 project URL>
V2_SUPABASE_SERVICE_ROLE_KEY=<V2 service role key>
```

---

## 6. Known Divergences (pre-registered)

These are intentional V2 differences that should be classified as `KNOWN_DIV` in shadow comparison:

| Surface | Divergence | Design reference |
|---------|------------|------------------|
| Promotion model | V2 uses weighted composite scoring; V1 uses tier + gate rules | `board_promotion_contract.md` |
| Channel routing | V2 routes by policy (best-bets, trader-insights); V1 routes by tier (S/A/B) | `discord_routing.md` |
| Odds provider | V2 uses SGO API; V1 uses Odds API + Optimal API | Provider decisions documented in V2 ingestor |
| Devig method | May differ — must verify before comparison | Check V1 `CLVComputeService.ts` vs V2 `@unit-talk/domain` |
| Confidence scale | V1: 0-1 float. V2: 1-10 integer (divided by 10 for trust score) | `submission_contract.md` |
| Market key format | V1: `stat_type` raw. V2: `normalizeMarketKey()` canonical | `PICK_METADATA_CONTRACT.md` |

---

## 7. Conclusion

All V1 surfaces are structured, queryable, and extractable via Supabase client. Shadow validation comparison scripts can proceed. The comparison scripts (UTV2-173, UTV2-174) are **unblocked** by this audit.

Next steps:
1. Confirm historical overlap dates (run overlap queries)
2. Write grading parity comparison script (UTV2-173)
3. Write CLV parity comparison script (UTV2-174)
