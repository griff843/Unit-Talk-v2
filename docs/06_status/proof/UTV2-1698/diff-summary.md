# Diff summary: UTV2-1698

MERGE_SHA: 8b97f49c9e5ae58566c882ed3b92fd36536cc46a

Execution-truth guards for `codex-exec`. No runtime, domain, DB, delivery or workflow-authority code.

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | `evaluateExecutionTruth` gains three guards and loses its `phase` parameter. Takes `issueId` and reads the checkpoint itself, so a stale phase cannot be supplied by any caller. |
| `scripts/ops/codex-exec.test.ts` | Regressions for all three rules, plus the assertion that a genuine run reaching implementation still succeeds. |
| `scripts/ops/execution-checkpoint.ts` | Supporting checkpoint surface for the above. |
| `scripts/ops/execution-checkpoint.test.ts` | Coverage for the checkpoint changes. |

## The three rules

1. **`REWORK_NO_SOURCE_CHANGE`** — a rework carrying findings that changes zero source files. Catches the two re-dispatches that returned SUCCESS having changed nothing.
2. **`INCOMPLETE_PHASE_PROGRESSION`** — `completed_phases` does not contain `implement`. Catches the fresh lane that stopped at `plan` and reported completed.
3. **`IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`** — the implement phase is marked complete but no source changed. Catches a self-reported phase with no real diff, which neither of the other two can see.

`countSourceFilesChanged` excludes `docs/` and `.ops/`: a proof-only or manifest-only commit is not implementation.

## Three defects found in review, all in the orchestrator's own addition

1. The rule was fed a **pre-spawn** phase snapshot, always `orient` on a fresh lane, so every first-attempt dispatch would have failed. Fixed by removing the parameter, not by adding a test — a test could not guard a wrong call site.
2. `checkpoint.phase` is the **next** phase to work on, not the ending phase, so a run that completed `plan` would have passed. Fixed by gating on `completed_phases`.
3. `completed_phases` is **written by the executor**, so claiming `implement` with no diff passed. Fixed by corroborating the claim against a real diff.

## Mutation results

| Mutation | Result |
|---|---|
| A · completed-phases rule removed | `not ok 25` — 52 pass / 1 fail |
| B · rework rule removed | `not ok 22`, `not ok 28` — 51 pass / 2 fail |
| C · gate on `checkpoint.phase` | `not ok 25` — 52 pass / 1 fail |
| D · self-attestation cross-check disabled | `not ok 26` — 52 pass / 1 fail |
| Restored | **53 / 53** across both modules |

## Known limitations, deliberately not addressed here

- `pnpm type-check` does not compile `scripts/ops/**`; `tsconfig.json` references only `packages/*` and `apps/*`. Tracked under a separate ticket per PM sequencing.
- A legitimate no-op run stays fail-closed per PM decision. A future `NO_CHANGE_REQUIRED` disposition with independent confirmation is required, and must never masquerade as SUCCESS.
