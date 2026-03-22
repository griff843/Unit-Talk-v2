# Week 20 E2E Validation Surface Matrix

## Purpose

This matrix records the main V2 runtime surfaces that should be validated during Week 20 and the evidence shape that would prove each surface is operational.

It is factual and execution-oriented. It does not change sprint authority, release truth, or contract scope.

## Validation Matrix

| Surface name | Main runtime boundary / file area | Why it matters | Expected proof type | Current confidence | Known dependency chain | Failure blocks READY |
|---|---|---|---|---|---|---|
| Submission path | `apps/api/src/server.ts`, `apps/api/src/submission-service.ts` | This is the canonical intake path that materializes validated submissions into persisted picks, lifecycle rows, and submission events. | integration test + service-level verification | High | `POST /api/submissions` -> `handleSubmitPick` -> `processSubmission()` -> `@unit-talk/domain` canonicalization -> `@unit-talk/db` repositories -> eager promotion evaluation | Yes |
| DomainAnalysis enrichment | `apps/api/src/domain-analysis-service.ts`, `apps/api/src/submission-service.ts` | This is the only authorized producer path for `pick.metadata.domainAnalysis`, and downstream truth depends on it being correct and fail-open. | unit test + integration test | High | submission processing -> `computeSubmissionDomainAnalysis()` -> `enrichMetadataWithDomainAnalysis()` -> persisted pick metadata | Yes |
| Promotion scoring fallback | `apps/api/src/promotion-service.ts` | This is the only currently approved downstream runtime consumer of `metadata.domainAnalysis`; if it is broken, domain analysis exists but is not actually used. | unit test + service-level verification | Medium | submission writes metadata -> promotion service reads `metadata['domainAnalysis']['edge']` via `readDomainAnalysisEdgeScore()` -> promotion score fallback | Yes |
| Settlement path | `apps/api/src/server.ts`, `apps/api/src/controllers/settle-pick-controller.ts`, `apps/api/src/settlement-service.ts` | Settlement is the canonical outcome-write path and is the basis for final lifecycle state, audit evidence, and downstream accounting truth. | integration test + service-level verification | High | `POST /api/picks/:id/settle` -> `settlePickController()` -> `recordPickSettlement()` -> settlement repository writes -> lifecycle transition -> audit log | Yes |
| Downstream corrected settlement truth | `apps/api/src/settlement-service.ts`, `packages/domain/src/outcomes/settlement-downstream.ts` | Corrected settlement chains must resolve to a single effective truth, or operator reads and downstream summaries will be wrong. | unit test + service-level verification | High | settlement records -> `resolveEffectiveSettlement()` -> `computeSettlementSummary()` -> loss attribution summary -> downstream bundle returned on settlement API path | Yes |
| Operator-web picks pipeline | `apps/operator-web/src/server.ts` | This is the primary read model for recent picks, promotion state, and effective settlement result shown to operators. | integration test + live/manual runtime proof | Medium | operator snapshot provider -> `picks`, `settlement_records`, `distribution_outbox`, `distribution_receipts`, `system_runs`, `audit_log` queries -> `summarizePicksPipeline()` -> `/api/operator/picks-pipeline` and dashboard HTML | Yes |
| Discord posting / distribution | `apps/api/src/distribution-service.ts`, `apps/worker/src/distribution-worker.ts`, `apps/worker/src/delivery-adapters.ts` | This proves queued work can become sent work with receipts, lifecycle transition to `posted`, and channel-specific evidence. | integration test + Discord receipt / posting evidence + live/manual runtime proof | Medium | qualified pick -> `enqueueDistributionWork()` -> `distribution_outbox` -> worker claims outbox -> delivery adapter sends/stubs -> receipt recorded -> lifecycle transitions to `posted` -> audit + system runs recorded | Yes |
| Doc-truth gate | `.agents/skills/doc-truth-audit/check-doc-truth.ps1`, `.github/workflows/doc-truth-gate.yml`, `docs/03_contracts/domain_analysis_consumer_contract.md`, `docs/02_architecture/week_19_downstream_consumer_matrix.md` | This is the active fail-closed documentation enforcement surface for domain-analysis consumer truth and protects PR accuracy in governed docs. | service-level verification | Medium | PR touches governed docs -> workflow detects changed doc -> checker enforces binary statuses and code proof -> PR fails on violation | No |
| Build / test / gate integrity | `package.json`, app package scripts, domain test suite, CI workflows | This is the broad confidence surface that the monorepo still compiles, lints, and executes its declared verification stack. | unit test + integration test + service-level verification | High | root `pnpm verify` -> env check -> lint -> type-check -> build -> test suite across API, worker, operator-web, smart-form, verification, and domain packages | Yes |

## Surface Notes

### Submission path

- Strong existing proof already exists in the API test surface and the server route structure.
- Week 20 should still verify one end-to-end accepted submission against a real repository mode, not only in-memory fixtures.

### DomainAnalysis enrichment

- This surface has both dedicated service logic and a consumer contract.
- The main runtime proof is that accepted submissions with odds persist `metadata.domainAnalysis`, while picks without usable odds fail open without breaking submission.

### Promotion scoring fallback

- This is not a separate write path, but it is the main proof that domain-analysis output is being consumed in live API behavior.
- Week 20 validation should confirm the fallback is actually used when primary edge score input is absent.

### Settlement path

- The main operational proof is not only record creation, but correct lifecycle and audit side effects.
- A valid Week 20 proof should include both initial settlement and correction handling.

### Downstream corrected settlement truth

- This surface is domain-heavy but operationally important because operator-web and settlement responses depend on effective corrected truth, not raw first-write truth.
- A strong proof should include a correction chain and verify effective result, correction depth, and aggregate ROI/hit-rate fields.

### Operator-web picks pipeline

- This is the main read-facing operational checkpoint for posted and settled picks.
- Week 20 should prefer database-backed runtime proof over demo-mode proof.

### Discord posting / distribution

- This is the least trustworthy surface without live evidence because worker logic can pass local tests while channel config, delivery auth, or receipt recording fails at runtime.
- The strongest proof is an actual sent outbox item with a recorded receipt and visible message ID in the operator surface.

### Doc-truth gate

- This is operational, but it is not itself a release blocker for runtime readiness unless Week 20 explicitly includes documentation-governance readiness.
- Current V1 scope is domain-analysis-specific, so proof should stay within those governed docs.

### Build / test / gate integrity

- This is the broadest synthetic confidence surface and should remain green throughout Week 20 verification.
- It does not replace runtime proof, but failure here is still a release blocker because it undermines trust in all other evidence.
