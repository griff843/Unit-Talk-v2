# Winning Picks Pipeline Truth Audit — UTV2-1324

**Produced:** 2026-06-26  
**Lane:** UTV2-1324 (T2 governance audit)  
**Basis:** UTV2-1325 grading/model inventory + code inspection + live DB counts  
**PM Constraints:** No CLV/ROI/edge claims. No certification changes. No DB mutation. No P3/P4 cert.

---

## Verdict

**Can the system currently produce measurable, profitable picks?**

### NOT YET

The pipeline is structurally sound but empirically unexercised post-Phase 7A. All components exist in code; none of the critical forward-flow paths have confirmed live evidence after the governance brake shipped.

---

## Pipeline Map

Full path: Raw Odds → Ingest → Submission → Promotion → Public Pick → Grading → Settlement → CLV

| Step | Code Location | Status | Evidence |
|---|---|---|---|
| Raw odds ingest (SGO) | `apps/ingestor/` | WORKING | Cycles confirmed post-UTV2-1286 watchdog deploy |
| Pick submission | `apps/api/src/submission-service.ts` | WORKING | Smart-form functional; unit tests pass |
| Promotion scoring | `apps/api/src/promotion-service.ts` | PARTIALLY_PROVEN | 5-score pipeline wired; DEBT-019/020 degrade 55% of score to fallback |
| Governance gate | Phase 7A brake | ACTIVE | All autonomous picks → `awaiting_approval`; no picks flow to public without PM |
| Public pick posting | `apps/discord-bot/` | NOT_TESTED | Discord disabled by PM guardrail |
| Grading | `apps/api/src/grading-service.ts`, `grading-cron.ts` | STRUCTURALLY_PROVEN | 58 unit tests pass; cron heartbeat unconfirmed post-UTV2-1257 deploy (2026-06-08) |
| Settlement write | `apps/api/src/settlement-service.ts` | PARTIALLY_PROVEN | 143 pre-Phase7A evidence settlements (90W/53L); 0 post-Phase7A |
| CLV write-back | `apps/api/src/clv-feedback.ts` | PARTIALLY_PROVEN | Schema + listRecent fix (UTV2-1321) proven; write path invoked by submission feedback loop only |
| CLV forward-flow | `apps/api/src/clv-feedback.ts` | UNPROVEN | Requires grading settlements with clv_percent populated; 0 qualifying post-deploy |
| Profit measurement | — | UNPROVEN | No settled corpus with CLV; no ROI computation path |

---

## Evidence Table

| Metric | Count | Source | Notes |
|---|---|---|---|
| Total picks in `canonical_picks` | ~126 (pre-Phase7A) | CLV join proof (UTV2-1262) | Stale snapshot |
| Picks with `awaiting_approval` status | Unknown | No live query this lane | Phase 7A brake active |
| Evidence settlements (total) | 143 | UTV2-1325 inventory | Pre-Phase7A (90W/53L) |
| Post-Phase7A settlements | 0 | UTV2-1325 inventory | Governance brake blocks flow |
| Qualifying settlements for CLV | 0 | UTV2-1325 inventory | Requires post-deploy grading run |
| Picks with `clv_percent` populated | Unknown | Not queried | Would require live DB read |

---

## CLV Path Truth

`apps/api/src/clv-feedback.ts` is a trust-score adjustment function, not a CLV write-back to picks. It:
1. Queries `settlement_records` with `source = 'grading'` via `listRecent(500, cutoffIso)` (lower-bound added by UTV2-1321)
2. Extracts `clv_percent` from settlement rows
3. Returns an adjustment to the capper's trust score

**CLV is NOT written to individual picks** — it feeds back into capper trust, not into a per-pick record. The `clv_percent` field must be populated in `settlement_records` at grading time.

**Blocking condition:** The grading-cron must run post-Phase7A with picks that have line movement data. No confirmed runs since 2026-06-08 (UTV2-1257 fix merged; no post-fix runtime proof).

---

## Promotion Score Degradation (from UTV2-1325)

| Dimension | Weight | Status |
|---|---|---|
| Confidence score | 25% | WORKING — submitter-provided |
| Edge score (real-edge-service) | 35% | DEGRADED — 92.4% = confidence proxy (DEBT-019: domainAnalysis unpopulated) |
| Readiness score | 20% | DEGRADED — 94.4% = constant 60 (DEBT-020: kellySizing unpopulated) |
| Recency score | 10% | STRUCTURALLY_PROVEN — formula working |
| Historical accuracy | 10% | STRUCTURALLY_PROVEN — formula working |
| **Net: constant fallback** | **55%** | Edge + readiness are model signals, both constant |

---

## Blocking Conditions for YES Verdict

For the answer to become YES, ALL of the following must be true:

1. **Grading-cron running in production** — confirmed heartbeat post-UTV2-1257 on Hetzner host
2. **At least one PM-approved public pick** — Phase 7A brake must be manually overridden for one pick to flow through
3. **That pick settles with a grading settlement** — `settlement_records` row with `source = 'grading'` and `clv_percent != null`
4. **CLV path exercised** — `computeClvTrustAdjustment` called and returns non-null result from that settlement
5. **DEBT-019 resolved** — `domainAnalysis` populated at promotion time (edge score becomes model-driven)
6. **DEBT-020 resolved** — `kellySizing` populated at promotion time (readiness score becomes live)

Items 1–4 are **runtime blockers** (infrastructure + governance). Items 5–6 are **model blockers** (code debt).

---

## Required Next Lanes

| Lane | Type | Unblocks |
|---|---|---|
| Confirm grading-cron heartbeat post-UTV2-1257 (inspect Hetzner logs) | T2 runtime verification | Blockers 1, first evidence post-deploy |
| DEBT-019: populate domainAnalysis at promotion time | T1 runtime | Blocker 5, edge score model-driven |
| DEBT-020: populate kellySizing at promotion time | T1 runtime | Blocker 6, readiness score live |
| PM: approve one test pick through full lifecycle | PM action | Blocker 2 |
| UTV2-1042: refresh P3 snapshot + PM verdict | PM action | P3 certification |

---

## Summary

| Question | Answer |
|---|---|
| Can we ingest picks? | YES |
| Can we score/promote picks? | PARTIALLY — 55% of score is constant fallback |
| Does the governance brake work? | YES — Phase 7A active |
| Do we grade picks? | STRUCTURALLY — unit tests pass; production heartbeat unconfirmed |
| Do we settle picks? | PARTIALLY — 143 pre-Phase7A; 0 post |
| Is CLV computed? | STRUCTURALLY — path exists; never exercised post-Phase7A |
| Can we claim profitable picks? | NO — no settled post-Phase7A corpus; no CLV realized; P4 uncertified |
