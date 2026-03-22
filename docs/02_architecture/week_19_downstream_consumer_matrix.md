# Week 19 Downstream Consumer Matrix

## Document Status

This document is:
- **NOT** a contract
- **NOT** a source of truth for runtime behavior
- A candidate analysis only

Only Section 1 reflects code-level reality. Section 2 lists surfaces that do NOT currently consume `metadata.domainAnalysis`. Audited 2026-03-21.

---

## Domain Analysis Output Shape

Week 18 analysis is stored in `pick.metadata.domainAnalysis` during submission processing.

Producer: `apps/api/src/domain-analysis-service.ts`

Fields:
- `impliedProbability`
- `decimalOdds`
- `version`
- `computedAt`
- `edge` (optional - present only when confidence is provided)
- `hasPositiveEdge` (optional)
- `kellyFraction` (optional)

---

## Section 1 - Proven Consumers (Code-Level Verified)

| Consumer | File | Status | Verified At |
|---|---|---|---|
| Submission Persistence | `apps/api/src/submission-service.ts` | ACTIVE | Week 18 commit `a310c00` |
| Promotion Scoring | `apps/api/src/promotion-service.ts` | ACTIVE | Week 19 commit `3fe3c72` |

### 1. Submission Persistence

**File:** `apps/api/src/submission-service.ts`

**Status:** ACTIVE

**Exact usage:** Calls `computeSubmissionDomainAnalysis(materialized.pick)` at line 55 and passes the result to `enrichMetadataWithDomainAnalysis()` at line 60. The enriched metadata is persisted to the pick record. This is the producer integration point - it writes `metadata.domainAnalysis` for all downstream readers.

**Fields consumed:** All fields (this surface produces the payload).

### 2. Promotion Scoring

**File:** `apps/api/src/promotion-service.ts`

**Status:** ACTIVE

**Exact usage:** `readDomainAnalysisEdgeScore()` (exported, line 419) reads `metadata['domainAnalysis']['edge']` and converts it to a 0-100 promotion score via `clamp(50 + rawEdge * 400, 0, 100)`. Called as a second-tier fallback in `readPromotionScoreInputs()`. Returns `null` when `domainAnalysis` is absent or `edge` is not a finite number.

**Fields consumed:** `edge` only.

**Fallback order:** explicit `promotionScores.edge` > domain analysis edge > confidence-based fallback.

---

## Section 2 - Documented Non-Consumers

These surfaces exist as files in the repo. The listed runtime boundary for each surface does NOT currently read `metadata.domainAnalysis`. Zero grep matches were confirmed for each listed file on 2026-03-21.

| Consumer | File | Status |
|---|---|---|
| Edge Validation | `packages/domain/src/edge-validation/index.ts` | NOT_CONSUMING |
| Operator Analytics / Read Model | `apps/operator-web/src/server.ts` | NOT_CONSUMING |
| Settlement Enrichment | `apps/api/src/settlement-service.ts` | NOT_CONSUMING |
| Distribution / Posting | `apps/api/src/distribution-service.ts`, `apps/worker/src/distribution-worker.ts` | NOT_CONSUMING |
| Promotion Audit / History Payload | `packages/db/src/repositories.ts` | NOT_CONSUMING |

### 3. Edge Validation

**File:** `packages/domain/src/edge-validation/index.ts`

**Status:** NOT_CONSUMING

This surface does NOT currently read `metadata.domainAnalysis`. The `packages/domain/src/edge-validation/` module exists as pure computation and remains separate from the current `metadata.domainAnalysis` runtime readers.

### 4. Operator Analytics / Read Model

**File:** `apps/operator-web/src/server.ts`

**Status:** NOT_CONSUMING

This surface does NOT currently read `metadata.domainAnalysis`. The operator-web surface reads picks and settlement data but does not extract or display domain analysis fields.

### 5. Settlement Enrichment

**File:** `apps/api/src/settlement-service.ts`

**Status:** NOT_CONSUMING

This surface does NOT currently read `metadata.domainAnalysis`. The settlement service reads metadata for loss-attribution inputs but does not reference domain analysis fields.

### 6. Distribution / Posting

**File:** `apps/api/src/distribution-service.ts`, `apps/worker/src/distribution-worker.ts`

**Status:** NOT_CONSUMING

This surface does NOT currently read `metadata.domainAnalysis`. Neither the distribution service nor the distribution worker references domain analysis in any form.

### 7. Promotion Audit / History Payload

**File:** `packages/db/src/repositories.ts`

**Status:** NOT_CONSUMING

This surface does NOT currently read `metadata.domainAnalysis`. The persistence layer in `packages/db/src/repositories.ts` has zero references to `domainAnalysis`, so promotion history persistence does not currently store the analysis payload.

---

## Audit Trail

- Original document created pre-Week 19 as candidate analysis
- Audited 2026-03-21 against codebase at commit `3fe3c72`
- 2 of 7 consumers confirmed as ACTIVE
- 5 of 7 consumers confirmed as NOT_CONSUMING
- Rewritten to reflect code-level truth only
