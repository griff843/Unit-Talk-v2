# UTV2-1251 — Verification

## Summary

Runtime decoupling of evidence accumulation from public delivery approval. `recordEvidenceSettlement` added to `settlement-service.ts`. `runGradingPass` updated to process `awaiting_approval` picks via evidence path. All delivery guards preserved. `pnpm verify` PASS (113 tests, 0 fail).

## Evidence

- `apps/api/src/settlement-service.ts` — `recordEvidenceSettlement` export added
- `apps/api/src/grading-service.ts` — evidence path added to `runGradingPass`
- `apps/api/src/recap-service.ts` — public recap summaries exclude evidence-plane settlement records
- 8 new tests covering evidence settlement, delivery path invariance, and grading pass behavior
- 4 recap tests covering evidence-plane exclusion from public recap stats and top-play selection
- `pnpm verify` PASS
- `pnpm type-check` PASS
- Architecture reference: `docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` (UTV2-1253, merged SHA 51be3689)

## Verification

**Issue:** UTV2-1251
**Tier:** T2
**Branch:** claude/utv2-1251-development-evidence-mode
**Date:** 2026-06-10
**Merge SHA:** `91ca67d033dc56a3b526954bbe9cf63b0d97a9be`
**Evaluator:** Claude Sonnet 4.6

---

## Commands run

- `pnpm type-check`: PASS
- `pnpm test` (scoped):
  - `tsx --test apps/api/src/settlement-service.test.ts`: 21 PASS, 0 FAIL
  - `tsx --test apps/api/src/grading-service.test.ts`: 61 PASS, 0 FAIL
- `pnpm verify`: PASS (exit code 0, 113 tests, 0 fail)
- `pnpm exec tsx --test apps/api/src/recap-service.test.ts`: PASS (25 tests, 0 fail)
- `pnpm exec tsx --test apps/api/src/grading-service.test.ts apps/api/src/settlement-service.test.ts`: PASS (82 tests, 0 fail)
- `scripts/ci/r-level-check.ts`: PASS (no rules matched — runtime-only lane, no DB schema changes)
- `pnpm test:db`: PASS (7 tests, 0 fail) — database-smoke.test.ts against live Supabase
  ```
  # tests 7
  # suites 0
  # pass 7
  # fail 0
  # cancelled 0
  # skipped 0
  # duration_ms 119264
  ```
- `tsx --test apps/api/src/t1-proof-utv2-1251-evidence-settlement.test.ts`: PASS against live Supabase
  ```
  # tests 2
  # suites 0
  # pass 2
  # fail 0
  # cancelled 0
  # skipped 0
  # duration_ms 35667
  ```
  Assertions verified against real Postgres:
  - picks.status stays awaiting_approval after settlement record write
  - distribution_outbox has zero rows (no Discord delivery)
  - recordEvidenceSettlement rejects non-awaiting_approval pick

---

## Exit criteria check

| Criterion | Status |
|---|---|
| `awaiting_approval` pick does not enqueue public Discord | PASS — explicit guard added, existing distribution-service.ts brake preserved |
| `awaiting_approval` pick is visible to evidence surfaces | PASS — settlement records appear in `settlement_records`, counted by roi-by-sport.ts and model-edge-proof.ts |
| `awaiting_approval` pick can be settlement/CLV eligible if proof criteria exist | PASS — `recordEvidenceSettlement` computes CLV and writes settlement record |
| Synthetic/test picks remain excluded | PASS — grading skips picks without event context, unsupported markets, missing lines |
| Voided picks remain excluded | PASS — voided picks are not in `awaiting_approval`, not fetched by grading pass |
| No lifecycle FSM change | PASS — `picks.status` never transitions in evidence path |
| No schema migration added | PASS — runtime-only change |
| No public Discord delivery path opened | PASS — existing delivery guards not modified |
| Evidence-plane settlements excluded from public recaps | PASS — recap-service filters `payload.evidencePlane === true` before public summary/top-play selection |
| `pnpm verify` green | PASS |

---

## Delivery invariant audit

Three independent guards block `awaiting_approval` picks from Discord:

1. `distribution-service.ts:229` — `AwaitingApprovalBrakeError` thrown on enqueue
2. `run-audit-service.ts` — defense-in-depth enqueue check
3. `grading-service.ts` — explicit `if (pick.status !== 'awaiting_approval')` guard on `postSettlementRecapIfPossible`

None of these were removed or modified.

---

## Evidence path description

```
runGradingPass():
  postedPicks  = listByLifecycleState('posted')        → existing delivery path
  evidencePicks = listByLifecycleState('awaiting_approval') → new evidence path

  for posted pick:
    atomicClaimForTransition('posted' → 'settled')
    recordGradedSettlement()  → picks.status = 'settled', Discord recap eligible

  for awaiting_approval pick:
    [skip atomicClaimForTransition]
    recordEvidenceSettlement()  → picks.status stays 'awaiting_approval'
                                → settlement record written with CLV
                                → audit action = 'settlement.evidence_graded'
                                → evidencePlane: true in payload
    [skip postSettlementRecapIfPossible]
```

---

## R-Level compliance

R-level check: no rules matched. Runtime-only lane — no database migrations, no schema changes, no contracts changes. T2 tier.

## Post-Merge SHA Binding

This verification packet is bound to merged `main` commit `91ca67d033dc56a3b526954bbe9cf63b0d97a9be` for PR #1006.
