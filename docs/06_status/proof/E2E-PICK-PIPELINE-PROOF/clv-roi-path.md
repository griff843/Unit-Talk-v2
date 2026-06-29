# CLV and ROI Path Documentation

**Date:** 2026-06-29  
**Issue:** UTV2-1359

---

## CLV Computation Path

**Service:** `apps/api/src/clv-service.ts` + `settlement-service.ts:computeCLVOutcome`

**Source hierarchy (INIT-4.3.1):**
1. `market_universe_provenance` (rank 1, verified) — used for pick a122bcca
2. `pinnacle_closing` (rank 2)
3. `consensus_closing` (rank 3)
4. `market_universe_fallback` (rank 4)

**Pick a122bcca CLV result:**
```json
{
  "clvRaw": 0.034949,
  "pickOdds": -141,
  "clvPercent": 3.4949,
  "closingLine": 0.5,
  "closingOdds": -141,
  "providerKey": "sgo",
  "beatsClosingLine": true,
  "closingSnapshotAt": "2026-06-28T03:00:16.917+00:00",
  "closingSourceVerification": {
    "rank": 1,
    "isVerified": true,
    "sourceType": "market_universe_provenance",
    "providerKey": "sgo",
    "hierarchyVersion": "1"
  }
}
```

**CLV coverage:**
- Evidence-graded settlements (evidence_ref like 'game-result:%'): 1,463 records, all have profitLossUnits
- Of those, CLV is computed when closing line data exists in market_universe
- Overall settlement coverage: ~11% (1,259 / 11,127) — lower for historical picks where closing data was not captured

---

## ROI Path

**Source:** `settlement_records.payload` (JSONB)

**ROI is stored at two levels:**

### Per-pick (settlement record payload)
- `payload.profitLossUnits` — signed unit P/L (-1 for loss at -141 odds, +amount for win)
- `settlement_records.stake_units` — stake in canonical units (1.00)

**Pick a122bcca:**
```json
{
  "profitLossUnits": -1,
  "stakeUnitsStatus": "canonical"
}
stake_units: 1.00
result: "loss"
```

### Batch (audit_log settlement.evidence_graded payload)
```json
{
  "downstream": {
    "settlementSummary": {
      "flat_bet_roi": {
        "roi_pct": -100,
        "total_profit": -110,
        "total_wagered": 110
      },
      "by_result": { "loss": 1 },
      "hit_rate_pct": 0
    }
  }
}
```

**ROI derivation query:**
```sql
SELECT
  result,
  COUNT(*) as picks,
  SUM((payload->>'profitLossUnits')::numeric) as total_pl_units,
  SUM(stake_units) as total_wagered_units,
  ROUND(
    SUM((payload->>'profitLossUnits')::numeric) / NULLIF(SUM(stake_units), 0) * 100, 2
  ) as roi_pct
FROM settlement_records
WHERE corrects_id IS NULL
  AND evidence_ref LIKE 'game-result:%'
  AND payload->>'profitLossUnits' IS NOT NULL
GROUP BY result;
```

---

## Known CLV Snapshot Bug (UTV2-1360)

`pick_offer_snapshots_devig_mode_check` constraint fails during closing-line snapshot writes:

```
Constraint: CHECK (devig_mode = ANY (ARRAY['PAIRED', 'FALLBACK_SINGLE_SIDED']))
Error: 787 failures logged in audit_log as 'closing_for_clv_snapshot_write_failed'
Impact: Non-blocking (CLV still computes from market_universe_provenance)
Fix: settlement-service writes invalid devig_mode value; must be clamped to valid enum
```
