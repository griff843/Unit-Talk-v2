# Contract Enforcement Audit — 2026-03-29

**Issue:** UTV2-146
**Lane:** claude (verification)
**Date:** 2026-03-29
**Scope:** All ratified contracts in `docs/05_operations/` audited against runtime implementations
**Cadence:** Recommended after each milestone close

---

## Method

For each ratified contract, runtime implementation was read directly and compared against contract acceptance criteria. Findings classified as:

- `MATCH` — Implementation fully satisfies contract requirements
- `PARTIAL` — Core contract satisfied; minor gaps or not-yet-active items remain
- `DRIFT` — Material divergence between contract and runtime; remediation required

New Wave 1/2 contracts (ratified 2026-03-29) are in a separate section — Codex implementation pending.

---

## Pre-Existing Contracts (Tier 2 Architecture + Tier 3 Product)

### 1. `submission_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| `processSubmission()` validates, creates pick (lifecycleState=validated), evaluates promotion | `apps/api/src/submission-service.ts:50-137` | Full contract flow |
| `createValidatedSubmission()` creates typed ValidatedSubmission | `packages/domain/src/submission.ts:7-23` | |
| Smart-form hardcodes `source: 'smart-form'` | `apps/smart-form/lib/form-utils.ts:72` | Source governance enforced |
| Promotion evaluation called at submission time | `submission-service.ts:121-126` | `evaluateAllPoliciesEagerAndPersist()` |

No DRIFT. Source enforcement is correct; API submissions allow any string source by design (smart-form governs its own source).

---

### 2. `pick_lifecycle_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| `allowedTransitions` map: validated→[queued,voided], queued→[posted,voided], posted→[settled,voided] | `packages/db/src/lifecycle.ts:27-34` | Exact state machine |
| Invalid transition throws error (not silent) | `lifecycle.ts:38-40` | `throw new Error(...)` on disallowed transition |
| Worker transitions pick to `posted` after delivery | `apps/worker/src/distribution-worker.ts:121-127` | via `transitionPickLifecycle()` |
| Settlement transitions pick to `settled` | `apps/api/src/settlement-service.ts:292-298` | via `transitionPickLifecycle()` |

No DRIFT.

---

### 3. `distribution_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| Qualification gate: `promotionStatus === 'qualified'` before enqueue | `apps/api/src/distribution-service.ts:17-24` | |
| `promotionTarget` must match requested target | `distribution-service.ts:26-29` | |
| Outbox rows have `idempotency_key` | `distribution-service.ts:33-38` | Unique partial index on DB |
| Receipts recorded after delivery with `idempotency_key` | `apps/worker/src/distribution-worker.ts:128-136` | |
| Audit row written with `entity_id = outbox.id` | `distribution-worker.ts:147-159` | |

No DRIFT.

---

### 4. `settlement_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| Feed settlement source blocked with 409 | `apps/api/src/settlement-service.ts:68-74` | Before any DB writes |
| Wrong-state guard: only `posted` picks can be initially settled | `settlement-service.ts:85-91` | Routes by current pick status |
| Manual review does NOT transition lifecycle to `settled` | `settlement-service.ts:219-233` | `status = manual_review`, lifecycle stays `posted` |
| Corrections write new row with `corrects_id` pointing to prior | `settlement-service.ts:366` | Original rows never mutated |
| `corrects_id` self-ref FK in schema | `supabase/migrations/...` | DB-level immutability |

No DRIFT.

---

### 5. `writer_authority_contract.md`

**Verdict: MATCH**

| Table(s) | Authority | Evidence |
|---|---|---|
| submissions, picks, pick_lifecycle, pick_promotion_history, distribution_outbox, settlement_records, audit_log | `apps/api` only | Confirmed no writes from worker or operator-web |
| distribution_outbox (claim/mark), distribution_receipts, audit_log, pick_lifecycle (transitions), system_runs | `apps/worker` only | `distribution-worker.ts:43,85,120,121-127,128-136,147,176` |
| No writes | `apps/operator-web` | Read-only confirmed |

No DRIFT. Worker authority is correctly scoped to the allowed write surfaces only.

---

### 6. `environment_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| Priority cascade: `.env.example` → `.env` → `local.env` | `packages/config/src/env.ts:77-92` | Later entries override earlier |
| Required vars validated at startup | `env.ts:94-138` | Throws on missing required vars |
| `requireSupabaseEnvironment()` enforces service role key | `env.ts:143-155` | Hard fail if absent |
| No hardcoded credentials anywhere in source | Full codebase | Confirmed |

Minor finding (non-blocking): `SUPABASE_ACCESS_TOKEN` appears in `.env.example` but is never referenced in `env.ts`. Dead env var — cleanup candidate (UTV2-139 noted this).

No DRIFT from contract perspective.

---

### 7. `discord_routing.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| `parseGovernedPromotionTarget()` restricts to best-bets, trader-insights, exclusive-insights | `apps/api/src/distribution-service.ts:47-62` | Governed targets only |
| Target map loaded from `UNIT_TALK_DISCORD_TARGET_MAP` env var | `apps/worker/src/delivery-adapters.ts:115-127` | No hardcoded channel IDs |
| Canary bypasses promotion gate (returns null from parseGovernedPromotionTarget) | `distribution-service.ts:54-56` | Correct by design (integration test lane) |
| game-threads and strategy-room not routable | Full worker code | Delivery-blocked per routing doc |

No DRIFT.

---

### 8. `best_bets_channel_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| `bestBetsPromotionPolicy.minimumScore: 70` | `packages/contracts/src/promotion.ts:139` | Contract says 70.00 |
| Five score components computed: edge, trust, readiness, uniqueness, boardFit | `packages/domain/src/promotion.ts:150-154` | |
| Score weights: edge 0.35, trust 0.25, readiness 0.20, uniqueness 0.10, boardFit 0.10 | `contracts/src/promotion.ts:129-135` | `bestBetsScoreWeights` |

**NOTE:** `calculateScore()` currently hardcodes `bestBetsScoreWeights` for ALL targets — trader-insights and exclusive-insights picks are scored with best-bets weights. This is a known bug documented in UTV2-136 (MODEL_REGISTRY_CONTRACT.md), not a contract violation for best-bets itself. The best-bets contract MATCHES; the cross-target bug is a separate gap.

---

### 9. `board_promotion_contract.md`

**Verdict: MATCH**

| Evidence | File | Notes |
|---|---|---|
| Promotion and distribution are separate steps | `apps/api/src/promotion-service.ts` vs `distribution-service.ts` | No direct promotion→discord path |
| `evaluateAllPoliciesEagerAndPersist()` evaluates all three policies in parallel | `promotion-service.ts:144-156` | Winner selected by priority |
| Winner decision persisted to `pick_promotion_history` | `promotion-service.ts:164-182` | via `persistPromotionDecision()` |
| Non-winner policy rows also persisted | `promotion-service.ts:199-241` | via `insertPromotionHistoryRow()` |
| Distribution reads promotion eligibility separately before enqueuing | `distribution-service.ts:17-29` | |

No DRIFT.

---

## Wave 1 Hardening Contracts (Ratified 2026-03-29 — Codex Implementation Pending)

These contracts were ratified today. Runtime implementation is pending Codex Wave 1. Status reflects current code state — not a DRIFT in the governance sense, as implementation is explicitly in-flight.

| Contract | Issue | Current Code State | Expected After Codex |
|---|---|---|---|
| `PICK_METADATA_CONTRACT.md` | UTV2-122 | `pick.metadata` is untyped `Json` blob | `PickMetadata` interface with required fields |
| `ALERT_AGENT_EXTRACTION_CONTRACT.md` | UTV2-125 | Alert agent embedded in API process | Extracted to separate process |
| `RUNTIME_MODE_CONTRACT.md` | UTV2-147 | No fail-closed startup mode | `getRuntimeMode()` + fail-closed when credentials absent |

---

## Wave 2 Hardening Contracts (Ratified 2026-03-29 — Codex Implementation Pending)

| Contract | Issue | Current Code State | Blocking |
|---|---|---|---|
| `DELIVERY_ADAPTER_HARDENING_CONTRACT.md` | UTV2-148 | `DeliveryResult.status: string` (untyped) | None |
| `DISCORD_CIRCUIT_BREAKER_CONTRACT.md` | UTV2-124 | No circuit breaker | UTV2-148 |
| `MODEL_REGISTRY_CONTRACT.md` | UTV2-136 | Score weights hardcoded to bestBets for all targets | None |
| `REPLAYABLE_SCORING_CONTRACT.md` | UTV2-145 | No `PromotionDecisionSnapshot` stored | UTV2-136 |
| `MEMBER_TIER_MODEL_CONTRACT.md` | UTV2-149 | No `member_tiers` table | None |
| `PROMOTION_TARGET_REGISTRY_CONTRACT.md` | UTV2-129 | No `TargetRegistryEntry` / `defaultTargetRegistry` | None |

---

## Summary

| Contracts Audited | MATCH | PARTIAL | DRIFT |
|---|---|---|---|
| 9 pre-existing | 9 | 0 | 0 |
| 3 Wave 1 (pending impl) | — | — | — |
| 6 Wave 2 (pending impl) | — | — | — |

**All 9 pre-existing contracts: MATCH.** No DRIFT findings. No new implementation issues generated.

The one cross-cutting concern found — score weights bug in `calculateScore()` — was already captured in UTV2-136 before this audit.

**Recommended next audit:** After Wave 1 Codex PRs land — re-run this audit against the three Wave 1 contracts to verify implementation matches before Wave 2 verification begins.

---

## Audit Cadence Recommendation

Run this audit:
1. After each milestone close
2. Before activating a new Discord channel target
3. After any contract is amended

Output committed to `docs/06_status/contract_enforcement_audit_<YYYY-MM-DD>.md`.
