# Canonical Pipeline Vocabulary and Runtime Semantics

**Authority:** This document is the canonical source for term definitions used in pipeline monitoring, operational queries, and evidence reporting. When a metric or query description references these terms, the definitions here are authoritative.

**Rationale:** Multiple near-synonyms exist across the codebase (e.g., `pick.status='settled'` vs. evidence-settled vs. CLV-path settled). Conflating them produces incorrect counts and misleading verdicts. This document encodes the distinctions mechanically.

---

## Core Terms

### `evidence-settled`

A pick is **evidence-settled** when ALL of the following are true:

1. A `settlement_records` row exists for this pick
2. `settlement_records.result` ∈ `{win, loss, push}`
3. `settlement_records.evidence_ref IS NOT NULL`
4. `settlement_records.status = 'settled'`
5. The pick is not a shadow record (`picks.is_shadow IS NOT TRUE` or shadow column absent)
6. The pick is not voided (`picks.status != 'voided'`)
7. The pick was created through the production submission path (not a test fixture or synthetic record)

**Non-equivalences:**
- `pick.status = 'settled'` is NOT sufficient — a pick's lifecycle column may be `'settled'` without a corresponding `settlement_records` row, and vice versa during failure recovery
- `settlement_records` row count is NOT the evidence-settled count — rows with `result IS NULL`, `evidence_ref IS NULL`, or `status != 'settled'` are incomplete settlements

---

### `pick.status = 'settled'`

The lifecycle column `picks.status` reflects the pick's current lifecycle state. A value of `'settled'` indicates the pick has transitioned to the settled state but does NOT guarantee:

- A `settlement_records` row exists
- CLV was computed
- The pick is on the evidence plane

`pick.status = 'settled'` ≈ "the lifecycle FSM advanced to settled" — it is a state transition signal, not an evidence quality claim.

---

### `true settled CLV-path`

A pick is on the **true settled CLV-path** when it meets the evidence-settled criteria AND:

1. A join to `pick_candidates` succeeds (candidate record exists for this pick)
2. Closing odds exist in `settlement_records.payload` with `clvStatus = 'computed'` — meaning `clvService` resolved a valid closing source (one of: `market_universe_provenance`, `pinnacle_closing`, `consensus_closing`, `market_universe_fallback`)
3. `clvPercent` and `clvRaw` in `settlement_records.payload` are finite numbers

The CLV-path count is the primary metric for model evaluation (50-pick threshold applies).

**Closing source hierarchy (INIT-4.3.1):**
1. `market_universe_provenance` (rank 1) — primary
2. `pinnacle_closing` (rank 2)
3. `consensus_closing` (rank 3)
4. `market_universe_fallback` (rank 4)

If none resolves: `clvStatus = 'missing_closing_line'` — pick is evidence-settled but NOT on the CLV path.

**Non-equivalences:**
- evidence-settled ≠ CLV-path (a pick can be evidence-settled with `clvStatus = 'missing_closing_line'`)
- `pick_offer_snapshots.snapshot_kind = 'closing_for_clv'` is a SEPARATE mechanism (queryability layer) — absence of a `closing_for_clv` snapshot does NOT mean closing odds are missing; check `settlement_records.payload.clvStatus` for the authoritative source

---

### `hasRealEdge`

A pick `hasRealEdge = true` when `real_edge_service` computed a positive model-probability-vs-market-probability delta above the configured threshold at submission time.

**Non-equivalences:**
- `hasRealEdge` is a submission-time signal — it does not update post-settlement
- `hasRealEdge = true` does NOT mean the pick is evidence-settled or on the CLV-path
- Do NOT use `hasRealEdge` as a proxy for CLV-path count

---

### `posted_at`

`picks.posted_at` is a **delivery timestamp** — the time the pick was distributed to a Discord channel or other delivery target via the outbox. It is NOT an event-start indicator.

**Non-equivalences:**
- `posted_at IS NULL` does NOT mean the game has not started
- `posted_at IS NULL` does NOT mean the pick is not public-facing
- `posted_at IS NULL` means the pick has not been delivered through the distribution outbox

For picks in `awaiting_approval` status, `posted_at` will be NULL by design (governance brake holds delivery). These picks can still receive settlement records on the evidence plane.

---

### `awaiting_approval`

A pick with `picks.status = 'awaiting_approval'` has been submitted and evaluated but is held at the governance brake — autonomous sources require PM approval before public delivery.

**Evidence plane behavior:** `awaiting_approval` picks are processed by the grading cron and receive `settlement_records` rows via `recordEvidenceSettlement()`. These rows use `status = 'evidence_only'` (not `'settled'`) to distinguish evidence accumulation from public settlement.

**Non-equivalences:**
- `awaiting_approval` does NOT mean the pick is excluded from grading
- `awaiting_approval` does NOT mean evidence cannot accumulate
- `awaiting_approval` DOES mean public Discord delivery is blocked

---

### `shadow`

A shadow pick is a synthetic record created for testing or replay purposes. Shadow picks are excluded from all operational counts, CLV-path analysis, and model evaluation.

Detection: `picks.is_shadow = true` or presence in a shadow source namespace (context-dependent).

---

### `voided`

A voided pick has been administratively cancelled after submission. Voided picks are excluded from all counts — evidence-settled, CLV-path, and model evaluation.

---

### `production-path`

A pick is on the **production path** when it was submitted through `apps/api` submission pipeline (not a direct DB insert, test fixture, or legacy migration) and is not shadow/voided.

---

### `pick_offer_snapshots.closing_for_clv`

A row in `pick_offer_snapshots` with `snapshot_kind = 'closing_for_clv'` is a **queryable snapshot** of closing odds captured at settlement time. This is a secondary queryability/auditability layer.

**Important:** As of 2026-06-10, `settlement_records.payload.clvStatus` is the authoritative closing odds source. `pick_offer_snapshots.closing_for_clv` is intended as a queryability supplement but is NOT currently wired in the settlement path.

**Non-equivalences:**
- Absence of a `closing_for_clv` snapshot does NOT mean closing odds were missing at settlement time
- For accurate CLV-path counts, query `settlement_records.payload->>'clvStatus' = 'computed'`

---

### `grading run_status`

`system_runs.status` for `runType = 'grading.run'`:

- `succeeded` — run completed; individual skipped picks (non-finite values, unsupported markets) do NOT cause `failed` status (grading skip fix)
- `failed` — run encountered a thrown error that prevented completion or exceeded the error threshold

Individual pick skips are recorded in `system_runs.details.failed` for audit and in `grading-service.ts` `details[]` array with `outcome = 'skipped'` and a `reason` string containing the skip category code (e.g., `game_result_actual_value_invalid`).

---

## Non-Equivalence Summary Table

| Term | Is NOT the same as |
|------|--------------------|
| `evidence-settled` | `pick.status = 'settled'` |
| `evidence-settled` | `settlement_records` row count |
| `true settled CLV-path` | `evidence-settled` |
| `true settled CLV-path` | `pick_offer_snapshots.closing_for_clv` count |
| `hasRealEdge = true` | CLV-path count |
| `posted_at IS NULL` | game not started |
| `posted_at IS NULL` | pick is not public |
| `awaiting_approval` | excluded from grading |
| `closing_for_clv snapshot absent` | closing odds missing |
| `grading run_status = failed` | individual pick skipped |

---

## Operational Query Patterns

### Count evidence-settled picks

```sql
SELECT COUNT(*)
FROM settlement_records sr
JOIN picks p ON sr.pick_id = p.id
WHERE sr.result IN ('win', 'loss', 'push')
  AND sr.evidence_ref IS NOT NULL
  AND sr.status = 'settled'
  AND (p.is_shadow IS NOT TRUE)
  AND p.status != 'voided';
```

### Count true CLV-path picks

```sql
SELECT COUNT(*)
FROM settlement_records sr
JOIN picks p ON sr.pick_id = p.id
JOIN pick_candidates pc ON pc.pick_id = p.id
WHERE sr.result IN ('win', 'loss', 'push')
  AND sr.evidence_ref IS NOT NULL
  AND sr.status = 'settled'
  AND (p.is_shadow IS NOT TRUE)
  AND p.status != 'voided'
  AND sr.payload->>'clvStatus' = 'computed';
```

### Count picks with non-finite actual_value skips

```sql
SELECT COUNT(*)
FROM system_runs
WHERE run_type = 'grading.run'
  AND details->>'failed' IS NOT NULL
  AND details->>'failed' != '0';
```

---

*Last updated: 2026-06-11. Authority: UTV2-1261.*
