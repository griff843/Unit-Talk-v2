# UTV2-1312 — G-CONST-17 Outbox Classification Audit

**Generated:** 2026-06-25T11:45:00Z  
**Audit type:** Read-only SQL scan — NO mutations, NO deletes, NO updates  
**Table audited:** `distribution_outbox` (public schema, Supabase project `zfzdnfwdarxucxtaojxm`)  
**Note:** The lane spec referenced table name `outbox`; actual table is `distribution_outbox`. Column `channel` → `target`; column `retry_count` → `attempt_count`. All queries adapted accordingly.

---

## 1. Status Summary

| status | count |
|---|---|
| sent | 1,700 |
| dead_letter | 946 |
| pending | 559 |
| processing | 1 |
| **TOTAL** | **3,206** |

---

## 2. By Target (channel equivalent)

| target | status | count |
|---|---|---|
| discord:best-bets | sent | 729 |
| discord:best-bets | dead_letter | 336 |
| discord:best-bets | pending | 226 |
| discord:canary | sent | 958 |
| discord:canary | dead_letter | 610 |
| discord:canary | pending | 333 |
| discord:recaps | sent | 12 |
| discord:trader-insights | sent | 1 |
| utv2-920:a6bd102e-… | processing | 1 |

Key observations:
- All pending and dead_letter rows are on `discord:best-bets` and `discord:canary` only.
- `discord:recaps` and `discord:trader-insights` are clean (sent only).
- The single `processing` row is a test-data artifact (`utv2-920:...` target) — not a real Discord target.

---

## 3. By Age Bucket

| status | age_bucket | count |
|---|---|---|
| dead_letter | >7d | 946 |
| pending | <1h | 13 |
| pending | 1-24h | 83 |
| pending | 24h-7d | 170 |
| pending | >7d | 293 |
| processing | >7d | 1 |
| sent | <1h | 7 |
| sent | 1-24h | 43 |
| sent | 24h-7d | 91 |
| sent | >7d | 1,559 |

Key observations:
- All 946 dead_letter rows are older than 7 days.
- 293 of 559 pending rows (52%) are older than 7 days — stale pending.
- 13 pending rows are fresh (<1h), 83 are within 24h — these are the live queue.
- The oldest pending row dates to **2026-06-10** (15+ days old), confirming the outbox worker is not draining stale rows.

---

## 4. By Retry (attempt_count) Bucket

| status | retry_bucket | count |
|---|---|---|
| dead_letter | 0 | 946 |
| pending | 0 | 559 |
| processing | 0 | 1 |
| sent | 0 | 1,696 |
| sent | 1-3 | 4 |

Critical finding: **ALL 559 pending rows and ALL 946 dead_letter rows have `attempt_count = 0`.**

This means:
- The outbox worker has never attempted delivery on any of these rows.
- The rows were not retried to exhaustion — they were blocked at the pre-delivery classification stage.
- `dead_letter` is not a result of retry exhaustion; it is a programmatic classification decision.

---

## 5. Stuck-Closed Pattern

```
stuck_closed (pending AND attempt_count >= 3): 0
```

No stuck-closed rows. All pending rows have `attempt_count = 0`.

---

## 6. Dead Letter Error Classification

| last_error | count |
|---|---|
| `proof-pick-blocked: source 't1-proof' is not a live source` | 610 |
| `stale_pending_operator_review` | 199 |
| `operator-disposition-2026-06-10: Mode 1 public delivery hold — stale discord:best-bets posts voided per PM go (board-clearing audit); not a system failure` | 97 |
| `governance_public_delivery_suppressed_mode1_predeploy` | 40 |

All 946 dead_letter rows have a known, intentional error classification:
- **610** — governance brake: proof-source blocks delivery (`t1-proof` is not a live source → blocked by G-CONST governance)
- **199** — operator review hold (`stale_pending_operator_review`)
- **97** — explicit PM operator disposition (Mode 1 public delivery hold, 2026-06-10)
- **40** — pre-deploy public delivery suppression

---

## 7. Oldest Rows Sample

| id | target | status | attempt_count | last_error | created_at |
|---|---|---|---|---|---|
| 4c761d42-… | discord:canary | dead_letter | 0 | proof-pick-blocked: source 't1-proof' is not a live source | 2026-05-28 |
| 93e5a18f-… | discord:canary | dead_letter | 0 | proof-pick-blocked: source 't1-proof' is not a live source | 2026-05-28 |
| 080d8e7e-… | discord:canary | dead_letter | 0 | proof-pick-blocked: source 't1-proof' is not a live source | 2026-05-29 |
| 80c9aa31-… | discord:canary | dead_letter | 0 | proof-pick-blocked: source 't1-proof' is not a live source | 2026-05-29 |
| 70f80582-… | discord:canary | dead_letter | 0 | proof-pick-blocked: source 't1-proof' is not a live source | 2026-05-29 |

Oldest pending rows (from separate query): created 2026-06-10, `attempt_count = 0`, `last_error = null`.

---

## 8. Classification Summary

| Classification | Count | Rationale |
|---|---|---|
| `stale_undeliverable_count` | **946** | All dead_letter rows — intentional governance/operator blocks, `attempt_count=0` |
| `legitimate_pending_count` | **96** | Pending rows <24h old (`<1h`: 13 + `1-24h`: 83) — actively queued |
| `stale_pending_count` | **463** | Pending rows >24h old with `attempt_count=0` — worker not draining them |
| `dead_letter_actionable_count` | **0** | All 946 are intentional governance classifications — not system failures |

---

## 9. Conclusions

1. **The outbox worker is not delivering pending rows.** 463 of 559 pending rows are >24h old with zero delivery attempts. The outbox worker appears stalled or delivery is being suppressed upstream.

2. **Dead letter queue is governance-generated noise, not failure.** Every dead_letter row has an explicit intentional classification (proof-source block, operator hold, Mode 1 suppression). No rows failed due to retry exhaustion.

3. **The `attempt_count = 0` across all non-sent rows is the key signal.** Normal retry-based dead_letter would show `attempt_count >= max_retries`. The `0` value means rows are being classified as dead_letter without being attempted — this is correct behavior for governance brakes.

4. **No unknown channels.** All targets are known Discord channels (`discord:best-bets`, `discord:canary`, `discord:recaps`, `discord:trader-insights`) or a test artifact.

5. **Fresh pending rows (13 in <1h) confirm the outbox is still receiving work** — the production pipeline is generating new picks — but the delivery worker is not processing them.

---

## 10. Recommended Follow-up (read-only — no execution)

1. **Investigate outbox worker health on Hetzner.** The stalled delivery of 463 pending rows points to the worker loop not cycling. Check `pnpm ops:brief` and production logs.

2. **Mode 1 suppression review.** 40 rows have `governance_public_delivery_suppressed_mode1_predeploy` — confirm whether Mode 1 is still active or can be lifted.

3. **`t1-proof` source block review.** 610 dead_letter rows blocked because `t1-proof` is not a live source. This is likely correct behavior post-Phase 7A (governance brake), but warrants confirmation that the correct live sources are registered.

4. **Stale pending (463 rows, >24h, attempt_count=0) cleanup.** If the outbox worker is confirmed healthy, these rows should be delivered or explicitly voided with operator dispositions. Do NOT delete without PM approval.

---

## 11. Companion JSON

```json
{
  "schema_version": 1,
  "generated_at": "2026-06-25T11:45:00Z",
  "table": "distribution_outbox",
  "note": "Lane spec referenced 'outbox'; actual table is 'distribution_outbox'. channel→target, retry_count→attempt_count.",
  "total_pending": 559,
  "total_dead_letter": 946,
  "total_sent": 1700,
  "total_processing": 1,
  "total_rows": 3206,
  "by_target": [
    {"target": "discord:best-bets", "status": "sent", "cnt": 729},
    {"target": "discord:best-bets", "status": "dead_letter", "cnt": 336},
    {"target": "discord:best-bets", "status": "pending", "cnt": 226},
    {"target": "discord:canary", "status": "sent", "cnt": 958},
    {"target": "discord:canary", "status": "dead_letter", "cnt": 610},
    {"target": "discord:canary", "status": "pending", "cnt": 333},
    {"target": "discord:recaps", "status": "sent", "cnt": 12},
    {"target": "discord:trader-insights", "status": "sent", "cnt": 1},
    {"target": "utv2-920:a6bd102e-f260-460f-8561-d53c67832a55", "status": "processing", "cnt": 1}
  ],
  "by_age_bucket": [
    {"status": "dead_letter", "age_bucket": ">7d", "cnt": 946},
    {"status": "pending", "age_bucket": "<1h", "cnt": 13},
    {"status": "pending", "age_bucket": "1-24h", "cnt": 83},
    {"status": "pending", "age_bucket": "24h-7d", "cnt": 170},
    {"status": "pending", "age_bucket": ">7d", "cnt": 293},
    {"status": "processing", "age_bucket": ">7d", "cnt": 1},
    {"status": "sent", "age_bucket": "<1h", "cnt": 7},
    {"status": "sent", "age_bucket": "1-24h", "cnt": 43},
    {"status": "sent", "age_bucket": "24h-7d", "cnt": 91},
    {"status": "sent", "age_bucket": ">7d", "cnt": 1559}
  ],
  "by_attempt_bucket": [
    {"status": "dead_letter", "attempt_bucket": "0", "cnt": 946},
    {"status": "pending", "attempt_bucket": "0", "cnt": 559},
    {"status": "processing", "attempt_bucket": "0", "cnt": 1},
    {"status": "sent", "attempt_bucket": "0", "cnt": 1696},
    {"status": "sent", "attempt_bucket": "1-3", "cnt": 4}
  ],
  "dead_letter_errors": [
    {"last_error": "proof-pick-blocked: source 't1-proof' is not a live source", "cnt": 610},
    {"last_error": "stale_pending_operator_review", "cnt": 199},
    {"last_error": "operator-disposition-2026-06-10: Mode 1 public delivery hold — stale discord:best-bets posts voided per PM go (board-clearing audit); not a system failure", "cnt": 97},
    {"last_error": "governance_public_delivery_suppressed_mode1_predeploy", "cnt": 40}
  ],
  "stuck_closed": 0,
  "stale_undeliverable_count": 946,
  "legitimate_pending_count": 96,
  "stale_pending_count": 463,
  "dead_letter_actionable_count": 0
}
```
