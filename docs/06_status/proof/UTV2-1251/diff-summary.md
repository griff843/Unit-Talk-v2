# UTV2-1251 — Diff Summary

## Summary

Runtime decoupling of public delivery approval from evidence accumulation. `awaiting_approval` picks can now be graded and have outcomes recorded in `settlement_records` without transitioning `picks.status`. This allows evidence counting (CLV tracking, ROI analysis) to proceed without Discord delivery. Addresses the INSUFFICIENT_DATA root cause identified in UTV2-1042.

**Merge SHA:** `91ca67d033dc56a3b526954bbe9cf63b0d97a9be`

## Evidence

- `apps/api/src/settlement-service.ts` — new `recordEvidenceSettlement` export
- `apps/api/src/grading-service.ts` — `runGradingPass` now processes both `posted` and `awaiting_approval` picks
- `apps/api/src/recap-service.ts` — public recap summaries exclude `payload.evidencePlane === true` settlements
- `apps/api/src/settlement-service.test.ts` — 5 new evidence-plane tests (all pass)
- `apps/api/src/grading-service.test.ts` — 3 new evidence grading tests (all pass)
- `apps/api/src/recap-service.test.ts` — evidence-plane recap exclusion tests (all pass)
- `pnpm verify` PASS
- Architecture reference: `docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` (UTV2-1253)

**Issue:** UTV2-1251 — Development Evidence Mode — decouple proof accumulation from public delivery approval
**Tier:** T2
**Lane type:** runtime
**Branch:** claude/utv2-1251-development-evidence-mode
**Evaluator:** Claude Sonnet 4.6
**Date:** 2026-06-10

---

## Files Changed

### Modified

- `apps/api/src/settlement-service.ts` — Added exported function `recordEvidenceSettlement` that records settlement outcomes for `awaiting_approval` picks without updating `picks.status`. Evidence-plane settlement records include CLV computation, provenance payload, and `evidencePlane: true` audit flag. Does NOT call `ensurePickLifecycleState` or `transitionPickLifecycle`.

- `apps/api/src/grading-service.ts` — Updated `runGradingPass` to also query `awaiting_approval` picks via `listByLifecycleState('awaiting_approval')`. For these picks, `atomicClaimForTransition` is skipped (no status transition) and `recordEvidenceSettlement` is called instead of `recordGradedSettlement`. Discord recap is explicitly skipped for evidence picks.

- `apps/api/src/settlement-service.test.ts` — Added 5 evidence settlement tests covering: pick status invariance, settlement record visibility, rejection of wrong-state picks, and delivery path unchanged.

- `apps/api/src/grading-service.test.ts` — Added 3 evidence grading tests covering: evidence grading creates settlement record, Discord recap skipped, posted and awaiting_approval picks both graded in same pass.

- `apps/api/src/recap-service.ts` — Excludes evidence-plane settlement records from public daily/weekly/monthly recap summaries.

- `apps/api/src/recap-service.test.ts` — Adds coverage for evidence-plane exclusion, public settlement inclusion, mixed public/evidence windows, and top-play evidence exclusion.

---

## Scope

This lane touches only `apps/api/src/` — runtime service layer. No schema migrations. No FSM changes. No contracts changes. No packages/db changes. Evidence counting queries (`roi-by-sport.ts`, `model-edge-proof.ts`) already query `settlement_records` directly and will naturally include evidence settlement records.

---

## Before/After Behavior

### Before

`runGradingPass` only graded `posted` picks. `awaiting_approval` picks (held by P7A governance brake) were never graded. 0 settlement records existed for CLV-path picks. Evidence threshold (50 settled CLV-path picks) could not be met.

### After

`runGradingPass` grades both `posted` and `awaiting_approval` picks. `awaiting_approval` picks receive settlement records with CLV when game outcomes are available. `picks.status` remains `awaiting_approval` — public Discord delivery is still blocked. Evidence counting scripts see the settlement records and can count toward the 50-pick threshold.

---

## Public Delivery Invariant

The public delivery path is unchanged. All existing guards are preserved:
- `distribution-service.ts` line 229: throws `AwaitingApprovalBrakeError` for `awaiting_approval` picks
- `run-audit-service.ts`: defense-in-depth check blocks distribution for `awaiting_approval`
- Explicit `if (pick.status !== 'awaiting_approval')` guard before `postSettlementRecapIfPossible` in grading service

No `awaiting_approval` pick can reach Discord delivery through any code path touched in this lane.

## Post-Merge SHA Binding

This proof packet is bound to merged `main` commit `91ca67d033dc56a3b526954bbe9cf63b0d97a9be` for PR #1006.
