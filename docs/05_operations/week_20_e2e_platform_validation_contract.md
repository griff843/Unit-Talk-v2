# Week 20 Contract — E2E Platform Validation

## Objective

Validate that every core runtime surface in V2 still works end-to-end after Weeks 16–19 feature work and governance hardening. No new features — validation only.

## Sprint Name

`SPRINT-WEEK20-E2E-PLATFORM-VALIDATION`

## Scope

### In Scope

1. **Submission path** — intake, canonicalization, persistence, lifecycle initialization
2. **DomainAnalysis enrichment** — `computeSubmissionDomainAnalysis`, `enrichMetadataWithDomainAnalysis`, fail-open on missing odds
3. **Promotion scoring** — `readDomainAnalysisEdgeScore` consumption, three-tier edge fallback, routing gates
4. **Settlement path** — initial settlement, manual review, corrections, lifecycle guards
5. **Downstream corrected settlement truth** — `resolveEffectiveSettlement`, `computeSettlementSummary`, `classifyLoss`, correction chains
6. **Operator-web read model** — picks pipeline, corrected settlement display, health, outbox, filters
7. **Discord posting / distribution** — outbox enqueue, worker claim/send/complete, delivery adapters, receipt recording, lifecycle transition
8. **Doc-truth gate** — both governed docs pass checker, V1 scope accurate
9. **Build / test / gate integrity** — `pnpm verify` composite (env-check, lint, type-check, build, test)

### Out of Scope (Non-Goals)

- New features or code changes (unless a blocking defect is found)
- Live runtime proofs (covered by post-activation observation gates)
- Performance testing or load testing
- New test infrastructure
- Changes to governance docs, status docs, or roadmap docs

## Validation Areas

| Area | Proof Shape | Minimum Evidence |
|------|------------|-----------------|
| Submission path | Integration test + service test | processSubmission materializes pick, lifecycle, events |
| DomainAnalysis enrichment | Unit test + integration test | computeSubmissionDomainAnalysis computes edge/Kelly; enrichment merges into metadata |
| Promotion scoring | Unit test + integration test | readDomainAnalysisEdgeScore converts edge to 0–100; three-tier fallback works |
| Settlement path | Integration test + service test | recordPickSettlement handles win/loss/push/manual_review/corrections |
| Downstream settlement truth | Service test | resolveEffectiveSettlement resolves correction chains; loss attribution classifies |
| Operator-web read model | Integration test | Picks pipeline, corrected settlement, health sections render |
| Discord distribution | Integration test | Outbox enqueue → claim → send → receipt → lifecycle transition |
| Doc-truth gate | Checker pass | Both governed docs pass check-doc-truth.ps1 |
| Build/test/gate integrity | Composite gate | `pnpm verify` passes (0 failures) |

## Acceptance Criteria

1. `pnpm verify` passes — 0 test failures, clean type-check, clean lint, clean build
2. Both governed docs pass doc-truth checker
3. All 9 validation areas have test evidence
4. No new regressions introduced
5. Structured A–K report produced with surface-by-surface verdict

## Codex Parallel Lane

One bounded Codex task allowed: produce `docs/02_architecture/week_20_e2e_validation_surface_matrix.md` — read-only surface inventory. Must not edit code, tests, governance docs, or status docs.

## Ratification

This contract is ratified as part of the Week 20 E2E Platform Validation sprint.
