# Week 21 Contract — Promotion Scoring Enrichment

## Objective

Wire existing submission-time domain analysis into promotion trust and readiness score inputs. Domain analysis edge and Kelly sizing are already computed at submission (Week 18) and consumed for the edge score (Week 19). This week extends that consumption to trust and readiness fallbacks.

## Sprint Name

`SPRINT-WEEK21-PROMOTION-EDGE-INTEGRATION`

## Scope

### In Scope

1. **Trust enrichment** — `readDomainAnalysisTrustSignal(metadata)`: when domain analysis has positive edge, produce a domain-backed trust score (replaces raw confidence fallback)
2. **Readiness enrichment** — `readDomainAnalysisReadinessSignal(metadata)`: when domain analysis has Kelly fraction > 0, produce Kelly-informed readiness (replaces hardcoded 80)
3. **Score input wiring** — modify `readPromotionScoreInputs()` to use domain-aware trust and readiness fallbacks
4. **Tests** — unit tests for each new function + integration tests through processSubmission

### Out of Scope (Non-Goals)

- Changing promotion policy thresholds (minimumScore, minimumEdge, minimumTrust)
- Changing score weights (0.35/0.25/0.20/0.10/0.10)
- New promotion targets or routing logic
- Changes to uniqueness or boardFit inputs
- Changes to domain-analysis-service.ts (submission-time computation)
- Settlement or distribution changes
- Live runtime proofs

## Design

### Trust Signal

`readDomainAnalysisTrustSignal(metadata)` → `number | null`

- If `domainAnalysis.hasPositiveEdge === true` AND `domainAnalysis.edge >= 0.05`: return 80 (domain-backed trust)
- If `domainAnalysis.hasPositiveEdge === true` AND `domainAnalysis.edge < 0.05`: return 65 (marginal domain trust)
- Otherwise: return null (fall through to confidence-based fallback)

Rationale: A pick with mathematically verified positive edge is more trustworthy than one relying on raw confidence alone. Picks with significant edge (≥5%) get higher trust; marginal-edge picks get moderate trust.

### Readiness Signal

`readDomainAnalysisReadinessSignal(metadata)` → `number | null`

- If `domainAnalysis.kellyFraction` is a positive number: return 85 (Kelly-quantified readiness)
- Otherwise: return null (fall through to default 80)

Rationale: A pick with Kelly-quantified sizing has been mathematically assessed for position readiness. This is a stronger readiness signal than the default.

### Score Input Wiring

```
trust fallback:     explicit promotionScores.trust > domain trust signal > confidence
readiness fallback: explicit promotionScores.readiness > domain readiness signal > 80
```

Existing fallback chain for edge is unchanged.

## Acceptance Criteria

1. `readDomainAnalysisTrustSignal` returns correct values for all edge scenarios
2. `readDomainAnalysisReadinessSignal` returns correct values for Kelly/no-Kelly scenarios
3. `readPromotionScoreInputs` uses domain-aware fallbacks
4. Existing promotion edge integration tests still pass (no regressions)
5. New unit tests cover trust/readiness signal functions
6. New integration tests verify end-to-end scoring through processSubmission
7. `pnpm verify` passes — 0 failures, clean type-check, clean lint, clean build

## Ratification

This contract is ratified as part of Week 21 Promotion Scoring Enrichment.
