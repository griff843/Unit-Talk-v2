# UTV2-1364 Diff Summary — Candidate Quality Gates

**Issue:** UTV2-1364  
**Tier:** T2  
**Branch:** `codex/utv2-1364-candidate-quality-gates`  
**Merge SHA:** 16632e9148f5cf30e3c26dfdfc09aff687dc11b0

## What Changed

### `apps/api/src/candidate-builder-service.ts`

Added 5 exports and integration for Gates 1 and 3 at the builder stage:

- `CANDIDATE_STALE_THRESHOLD_MS = 3_600_000` — stale data threshold constant
- `EXTREME_JUICE_THRESHOLD = 500` — extreme juice threshold constant
- `BuilderQualityGateInput` interface
- `BuilderQualityGateResult` interface
- `evaluateBuilderQualityGates(input, nowMs)` pure function — evaluates Gate 1 (extreme juice) and Gate 3 (stale data) before candidate creation
- `CandidateBuilderDependencies.audit?: AuditLogRepository` — optional audit repo for rejection events
- `CandidateBuilderResult.gateRejected` counter
- Build loop: calls gates before universe resolution; logs `candidate.rejected` to audit on rejection

### `apps/api/src/candidate-builder-service.test.ts`

- Added 6 pure unit tests for `evaluateBuilderQualityGates`
- Added 3 integration tests covering Gate 1 and Gate 3 in the full service (with audit log verification)

### `apps/api/src/candidate-scoring-service.ts`

Added Gates 2, 3 (with audit), 4, and 5 in the scoring loop:

- `computeFractionalKelly(modelProb, americanOdds)` helper
- **Gate 5 (SUPPRESS band):** reject before availability check — band=SUPPRESS means edge < C threshold
- **Gate 2 (Kelly=0):** reject before availability adjustment — uses pre-availability model_score so availability 'adjust' (reduce confidence) doesn't cause false rejections
- **Gate 3 (stale, with audit):** replaced silent `is_stale` skip with explicit audit log
- **Gate 4 (postgame):** reject if `event.event_date < today`
- `ScoringResult.qualityGateRejected` counter
- `EventRepository` and `AuditLogRepository` added to optional repos

### `apps/api/src/candidate-scoring-service.test.ts`

- Fixed `makeUniverseRow()` default `fair_over_prob: 0.56` → `0.6` (prevents SUPPRESS band firing on all existing tests via `computeModelBlend` formula: `0.9 * p`)
- Added `makeEventRow()` helper
- Added 6 quality gate tests: Gate 3 stale (scorer), Gate 4 past/future event, Gate 5 SUPPRESS band, Gate 2 negative/positive Kelly

## Files Changed

- `apps/api/src/candidate-builder-service.ts`
- `apps/api/src/candidate-builder-service.test.ts`
- `apps/api/src/candidate-scoring-service.ts`
- `apps/api/src/candidate-scoring-service.test.ts`

## Gates Implemented vs Spec

| Gate | Description | Implemented | Location |
|------|-------------|-------------|----------|
| 1 | Extreme juice (`\|odds\| > 500`) | Yes | builder-service + builder-test |
| 2 | Kelly=0 (`fractional_kelly <= 0`) | Yes | scoring-service + scoring-test |
| 3 | Stale data (`snapshot_age_ms > 3_600_000`) | Yes | builder-service (age) + scoring-service (is_stale audit) |
| 4 | Postgame (`eventStartTime in past`) | Yes | scoring-service + scoring-test |
| 5 | SUPPRESS band | Yes | scoring-service + scoring-test |
