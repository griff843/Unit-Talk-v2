# UTV2-1042 — Empirical Evidence Evaluation

**Verdict:** `INSUFFICIENT_DATA`
**Evaluated:** 2026-06-10T06:30:00Z
**Evaluator:** Claude Sonnet 4.6 (dispatch authorized by PM 2026-06-10)
**Supabase project:** `zfzdnfwdarxucxtaojxm`
**Post-cutover epoch:** 2026-06-07T13:38:28Z (D-CONST-6 resolution)
**Acceptance standard:** `docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md`

---

## Hard guardrails (preserved)

- This is NOT P3 certification
- This is NOT a CLV certification claim
- No DEVELOPING, STRONG, ELITE, or syndicate-readiness claim is made
- This evaluation closes honestly as `INSUFFICIENT_DATA`

---

## Section A: Sample inventory (post-cutover)

All queries run against `distribution_outbox`, `picks`, `pick_candidates`, `market_universe`,
and `settlement_records` as of 2026-06-10T06:30:00Z.

### CLV join path picks (picks with closing_over_odds)

```sql
SELECT 
  COUNT(*) AS total_clv_path_picks,
  SUM(CASE WHEN p.status = 'settled' THEN 1 ELSE 0 END) AS settled_count,
  SUM(CASE WHEN p.status = 'voided' THEN 1 ELSE 0 END) AS voided_count,
  SUM(CASE WHEN p.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS awaiting_count
FROM picks p
JOIN pick_candidates pc ON pc.pick_id = p.id
JOIN market_universe mu ON mu.id = pc.universe_id
WHERE mu.closing_over_odds IS NOT NULL
  AND p.created_at >= '2026-06-07T13:38:28Z';
```

**Result:**
| Metric | Count |
|--------|-------|
| Total picks on CLV path | 126 |
| Status: settled | **0** |
| Status: voided | 17 |
| Status: awaiting_approval | 100 |
| Status: other | 9 |

### Settled picks post-cutover (regardless of CLV path)

```sql
SELECT p.status, COUNT(*) as count
FROM picks p
JOIN settlement_records sr ON sr.pick_id = p.id
WHERE p.created_at >= '2026-06-07T13:38:28Z'
GROUP BY p.status;
```

**Result:**
| Status | Count |
|--------|-------|
| settled | 601 |
| validated | 896 |
| draft | 640 |
| **On CLV path** | **0** |

### Settled picks on CLV path

```sql
SELECT COUNT(*) as settled_on_clv_path
FROM settlement_records sr
JOIN picks p ON p.id = sr.pick_id
JOIN pick_candidates pc ON pc.pick_id = p.id
JOIN market_universe mu ON mu.id = pc.universe_id
WHERE p.created_at >= '2026-06-07T13:38:28Z'
  AND mu.closing_over_odds IS NOT NULL;
```

**Result: 0**

---

## Section B: CLV direction (pre-settlement proxy)

```sql
SELECT 
  COUNT(*) AS total_with_clv,
  AVG(mu.closing_over_odds - mu.opening_over_odds) AS avg_clv_raw,
  PERCENTILE_CONT(0.5) WITHIN GROUP 
    (ORDER BY mu.closing_over_odds - mu.opening_over_odds) AS median_clv_raw,
  SUM(CASE WHEN mu.closing_over_odds > mu.opening_over_odds THEN 1 ELSE 0 END) AS positive_clv_count,
  SUM(CASE WHEN mu.closing_over_odds <= mu.opening_over_odds THEN 1 ELSE 0 END) AS negative_or_neutral_clv_count
FROM picks p
JOIN pick_candidates pc ON pc.pick_id = p.id
JOIN market_universe mu ON mu.id = pc.universe_id
WHERE mu.closing_over_odds IS NOT NULL
  AND mu.opening_over_odds IS NOT NULL
  AND p.created_at >= '2026-06-07T13:38:28Z';
```

**Result:**
| Metric | Value |
|--------|-------|
| Total with opening + closing odds | 126 |
| Average CLV raw (closing − opening, American odds) | -1.6 |
| Median CLV raw | 0 |
| Picks where closing > opening | 3 |
| Picks where closing ≤ opening | 123 |

Note: Raw CLV in American odds units is a coarse proxy only. The acceptance standard requires
`settlement_records.payload.clvPercent` (devigged percent CLV). That data requires picks to
be settled — which has not occurred on the CLV path.

---

## Section C: ROI

**Not computable.** 0 settled picks on CLV path. No outcome data available.

---

## Section D: Brier score / calibration

**Not computable.** 0 settled picks. No outcome data for calibration.

---

## Root cause analysis

The gap between data-gate MET and empirical evidence INSUFFICIENT is structural:

1. **Governance brake (P7A):** 100 of 126 CLV-path picks are in `awaiting_approval` state.
   The P7A governance brake correctly holds autonomous-source picks pending PM approval.
   These picks cannot proceed to posting → settlement until approved.

2. **Timeline:** Post-cutover epoch is 2026-06-07 (3 days). Even for picks not governance-braked,
   sports events take time to complete and settle. The 601 post-cutover settled picks are real
   settlements, but their market_universe rows do not have `closing_over_odds` populated.

3. **CLV coverage / settlement mismatch:** The picks that have closed odds (CLV path) are
   a different cohort from the picks that have settled. No pick satisfies both conditions yet.

---

## Verdict

**`INSUFFICIENT_DATA`**

The DEVELOPING threshold requires ≥ 50 real-edge-backed **settled** bets on the CLV join path.

Current post-cutover settled picks on CLV join path: **0**

This lane closes as INSUFFICIENT_DATA. The data gate is open and evidence continues to accumulate.
Re-evaluate when either:
- PM approves governance-braked picks AND they settle, OR
- Non-braked picks accumulate on the CLV path and settle (requires further ingestor cycles)

P3 certification: **NOT possible** at this time.
CLV/ROI claim: **NOT possible** at this time.
DEVELOPING label: **NOT earned** — no settled CLV-path picks.
