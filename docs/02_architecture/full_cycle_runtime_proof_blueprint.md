# Full-Cycle Runtime Proof Blueprint

## Purpose

This document defines the shortest truthful path to a full-cycle runtime proof for V2.

It is not a sprint contract and it does not change status authority. It is a factual architecture-side blueprint that ties the desired proof to real repo surfaces that already exist.

## Target Proof

The desired end-to-end proof is:

1. Submit a pick through Smart Form
2. Persist the submission and canonical pick to DB
3. Route and post the pick through the distribution flow
4. Observe the result in operator-web command-center surfaces
5. Settle the pick through the canonical settlement path
6. Confirm downstream corrected settlement truth is visible
7. Confirm recap/stat/update surfaces are either present and updated or explicitly blocked

## Current State Summary

| Proof stage | Primary runtime surface | Current state | Evidence already present | Main missing proof |
|---|---|---|---|---|
| Smart Form submit | `apps/smart-form/app/**`, `apps/smart-form/lib/api-client.ts` | Partially proven | local package tests, prior browser submit audit | one durable live full-cycle proof run |
| API submission + DB write | `apps/api/src/server.ts`, `apps/api/src/submission-service.ts` | Strong | API tests, direct submit evidence, repository-backed path | explicit DB-row proof in the same run |
| Promotion evaluation | `apps/api/src/promotion-service.ts` | Strong | domain-analysis fallback tests, eager promotion path in submission flow | proof that one submitted pick reaches the intended lane |
| Distribution + Discord | `apps/api/src/distribution-service.ts`, `apps/worker/src/distribution-worker.ts`, `apps/worker/src/delivery-adapters.ts` | Strong in code, weaker in live proof | worker tests, receipts/outbox flow, live routing infrastructure | one explicit live send + receipt proof in the target run |
| Command center visibility | `apps/operator-web/src/server.ts` | Good base | operator-web read-model tests, picks pipeline, channel health | proof that the same submitted and posted pick appears in operator-web |
| Settlement | `apps/api/src/controllers/settle-pick-controller.ts`, `apps/api/src/settlement-service.ts` | Strong | settlement tests, correction truth, downstream bundle | proof against the same full-cycle pick |
| Downstream corrected truth | `packages/domain/src/outcomes/settlement-downstream.ts`, `apps/api/src/settlement-service.ts`, `apps/operator-web/src/server.ts` | Strong base | domain tests, service tests, operator-web effective settlement use | proof that the settled pick resolves correctly in read surfaces |
| Recap / stats / reporting | no single active runtime surface yet | Not ready | domain modules exist (`rollups`, `evaluation`, `system-health`, `baseline-roi`) | real runtime consumer path |

## Required Runtime Surfaces

### 1. Smart Form intake

- Files:
  - `apps/smart-form/app/submit/page.tsx`
  - `apps/smart-form/app/submit/components/BetForm.tsx`
  - `apps/smart-form/lib/api-client.ts`
  - `apps/smart-form/lib/form-utils.ts`
- Proof needed:
  - one browser-driven submission using the live Next surface
  - request accepted by `POST /api/submissions`

### 2. Canonical submission path

- Files:
  - `apps/api/src/server.ts`
  - `apps/api/src/submission-service.ts`
  - `apps/api/src/domain-analysis-service.ts`
- Current wiring:
  - submission is validated and materialized into canonical pick state
  - `computeSubmissionDomainAnalysis()` and `enrichMetadataWithDomainAnalysis()` run inside `processSubmission()`
  - eager promotion evaluation happens before submission returns
- Proof needed:
  - confirm submission row, pick row, lifecycle event, and promotion decision exist for the same run

### 3. Distribution path

- Files:
  - `apps/api/src/distribution-service.ts`
  - `apps/worker/src/distribution-worker.ts`
  - `apps/worker/src/delivery-adapters.ts`
- Current wiring:
  - qualified picks enter the outbox flow
  - worker claims work, delivers, records receipts, and advances lifecycle to `posted`
- Proof needed:
  - one real outbox record moves to sent
  - one real receipt is recorded
  - one real Discord message or receipt-equivalent evidence is captured

### 4. Operator command center

- Files:
  - `apps/operator-web/src/server.ts`
- Current wiring:
  - reads picks, settlements, outbox rows, receipts, runs, and audit
  - computes picks pipeline and effective settlement view
  - exposes health for canary, best-bets, and trader-insights
- Proof needed:
  - same proof pick appears in operator snapshot / picks pipeline
  - same proof post appears in channel health / receipt surfaces

### 5. Settlement path

- Files:
  - `apps/api/src/controllers/settle-pick-controller.ts`
  - `apps/api/src/settlement-service.ts`
- Current wiring:
  - canonical settlement write path is active
  - downstream bundle is returned
  - correction truth is additive and effective-settlement based
- Proof needed:
  - settle the same proof pick
  - confirm lifecycle and downstream bundle update

### 6. Downstream corrected truth

- Files:
  - `packages/domain/src/outcomes/settlement-downstream.ts`
  - `apps/api/src/settlement-service.ts`
  - `apps/operator-web/src/server.ts`
- Current wiring:
  - settlement service computes effective truth and summaries
  - operator-web reads effective settlement for picks pipeline rows
- Proof needed:
  - confirm post-settlement operator view matches effective truth

## Current Hard Blockers

### Blocker A - gate stability

The repo must have a deterministic root verify path before the full-cycle proof becomes a dependable production-readiness check.

Current tracked follow-on:
- `UTV2-36` Batch 2 - harden root verify path for deterministic Windows execution

### Blocker B - recap/stat runtime consumer

The domain package contains recap-adjacent logic, but there is not yet a single active runtime surface that turns settlement/downstream truth into a recap or stats update.

Modules already available:
- `packages/domain/src/rollups`
- `packages/domain/src/evaluation`
- `packages/domain/src/system-health`
- `packages/domain/src/outcomes/baseline-roi.ts`

Missing:
- active application-layer consumer path
- read-model surface in operator-web or another command-center surface

## Minimal Full-Cycle Proof Sequence

1. Start from a clean green repo gate state
2. Submit one pick through Smart Form
3. Capture:
   - API response
   - canonical DB row IDs
   - promotion decision outcome
4. Run the worker until the outbox item is either sent or fails
5. Capture:
   - outbox status
   - receipt row
   - Discord evidence
   - operator-web picks pipeline entry
6. Settle the same pick
7. Capture:
   - settlement record
   - downstream bundle
   - operator-web updated settlement view
8. Record whether recap/stat surfaces updated
   - if yes, capture evidence
   - if no, mark explicit follow-on blocker instead of inferring completion

## Evidence Checklist

| Stage | Required evidence |
|---|---|
| Smart Form submit | browser proof + accepted submission response |
| API write | submission ID + pick ID + lifecycle state |
| DB persistence | row-level proof for submission, pick, and outbox if created |
| Distribution | outbox status change + receipt row |
| Discord | channel message or receipt with external message ID |
| Operator-web | picks pipeline row + channel/receipt visibility |
| Settlement | settlement API response + settlement row |
| Downstream truth | effective settlement summary in service and read model |
| Recap/stats | explicit runtime output or explicit blocker note |

## What Counts as Success

The full-cycle proof is successful when one single pick can be traced across:

- intake
- canonical persistence
- promotion/distribution
- operator visibility
- settlement
- downstream corrected truth

The proof is not complete if recap/stat updates are merely assumed. That stage must either exist with evidence or be called out as not yet implemented.
