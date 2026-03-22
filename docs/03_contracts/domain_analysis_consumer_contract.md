# Domain Analysis Consumer Contract

**Version:** 1.0
**Ratified:** 2026-03-21
**Audit basis:** Commit `3fe3c72`

---

## Canonical Source

| Field | Value |
|---|---|
| Payload location | `pick.metadata.domainAnalysis` |
| Producer | `apps/api/src/domain-analysis-service.ts` |
| Integration point | `apps/api/src/submission-service.ts` (calls `computeSubmissionDomainAnalysis()` and `enrichMetadataWithDomainAnalysis()`) |
| Write timing | Submission processing, before persistence |
| Fail-open rule | Picks without odds are not enriched; missing `domainAnalysis` is a valid state |

### Payload Fields

| Field | Type | Presence |
|---|---|---|
| `impliedProbability` | `number` | Always (when payload exists) |
| `decimalOdds` | `number` | Always (when payload exists) |
| `version` | `string` | Always (when payload exists) |
| `computedAt` | `string` (ISO 8601) | Always (when payload exists) |
| `edge` | `number` | Only when confidence is provided |
| `hasPositiveEdge` | `boolean` | Only when edge is computed |
| `kellyFraction` | `number` | Only when edge is computed and positive |

---

## Approved Consumers

There are exactly two approved consumers. No other consumer is authorized.

### 1. Submission Persistence (Producer Integration)

**File:** `apps/api/src/submission-service.ts`

**Status:** ACTIVE

**Role:** Producer integration

**Functions:** `computeSubmissionDomainAnalysis()`, `enrichMetadataWithDomainAnalysis()`

**Access type:** Write (produces the payload and persists it on the pick)

**Verified:** Week 18, commit `a310c00`

### 2. Promotion Scoring

**File:** `apps/api/src/promotion-service.ts`

**Status:** ACTIVE

**Role:** Scoring input (edge fallback)

**Function:** `readDomainAnalysisEdgeScore()`

**Fields read:** `edge` only

**Access type:** Read-only

**Conversion:** `clamp(50 + rawEdge * 400, 0, 100)`

**Null behavior:** Returns `null` when `domainAnalysis` is absent or `edge` is not a finite number

**Verified:** Week 19, commit `3fe3c72`

---

## Forbidden Usage

The following are NOT authorized to read `metadata.domainAnalysis`:

| Surface | File | Status |
|---|---|---|
| Operator analytics / read model | `apps/operator-web/src/server.ts` | NOT_CONSUMING |
| Settlement enrichment | `apps/api/src/settlement-service.ts` | NOT_CONSUMING |
| Distribution / posting | `apps/api/src/distribution-service.ts` | NOT_CONSUMING |
| Distribution worker | `apps/worker/src/distribution-worker.ts` | NOT_CONSUMING |
| Promotion audit / history payload | `packages/db/src/repositories.ts` | NOT_CONSUMING |
| Edge validation (domain module) | `packages/domain/src/edge-validation/index.ts` | NOT_CONSUMING |
| Any UI surface | `apps/smart-form/src/index.ts` | NOT_CONSUMING |
| Any script or CLI tool | `apps/api/src/scripts/query-runs.ts` | NOT_CONSUMING |

No downstream mutation of `metadata.domainAnalysis` is permitted after persistence. The payload is immutable once written by the submission persistence consumer.

---

## Drift Detection

A drift violation exists if ANY of the following are true:

1. A file not listed in Approved Consumers references `metadata.domainAnalysis`, `metadata['domainAnalysis']`, or imports `readDomainAnalysisEdgeScore`
2. An approved consumer listed in this contract does not exist in the codebase or does not reference `domainAnalysis`
3. The producer file (`domain-analysis-service.ts`) is modified without updating this contract
4. A new field is added to the payload without updating the Payload Fields table

### Detection Method

```bash
# Find all .ts files referencing domainAnalysis (excluding tests and docs)
grep -r "domainAnalysis" apps/ packages/ --include="*.ts" \
  --exclude="*.test.ts" --exclude="*.d.ts" \
  -l
```

Expected output (exactly these files, no others):
```
apps/api/src/domain-analysis-service.ts
apps/api/src/submission-service.ts
apps/api/src/promotion-service.ts
```

Any additional file in the output is a contract violation. Fail closed.

---

## Expansion Protocol

To add a new consumer of `metadata.domainAnalysis`:

1. **Update this contract** — add the consumer to the Approved Consumers section with file path, role, functions, fields read, and access type
2. **Remove from Forbidden Usage** — move the surface from Forbidden to Approved
3. **Implement the code** — write the consumption logic
4. **Add tests** — prove the consumption is correct and deterministic
5. **Run drift detection** — confirm the grep output matches the updated contract
6. **Provide proof artifact** — capture test output and drift detection output
7. **Re-audit** — confirm no unauthorized consumers were introduced alongside the new one

No consumer may be added without completing all seven steps. Skipping any step is a contract violation.

---

## Authority

This contract governs all read and write access to `pick.metadata.domainAnalysis`. It supersedes any candidate analysis, roadmap suggestion, or planning document that implies broader consumption. The downstream consumer matrix (`docs/02_architecture/week_19_downstream_consumer_matrix.md`) is a candidate analysis document and is NOT authoritative for access control.
