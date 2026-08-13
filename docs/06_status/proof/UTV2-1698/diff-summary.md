# Diff summary: UTV2-1698

MERGE_SHA: ae41936657472e31da0d795c551cb5d493047c30

Execution-truth guards for `codex-exec`. No runtime, domain, DB, delivery or workflow-authority code.

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | `evaluateExecutionTruth` gains three guards and loses its `phase` parameter. Takes `issueId` and reads the checkpoint itself, so a stale phase cannot be supplied by any caller. `shouldInvalidateForRework` extracted so dry-run purity is reachable from a regression. No scope, deliverable or proof-only input exists. |
| `scripts/ops/codex-exec.test.ts` | Regressions for all three rules, dry-run purity, the production call site, the absence of the removed proof-only surface, and the assertion that a genuine run reaching implementation still succeeds. |
| `scripts/ops/execution-checkpoint.ts` | Supporting checkpoint surface for the above. |
| `scripts/ops/execution-checkpoint.test.ts` | Coverage for the checkpoint changes. |

## The three rules

1. **`REWORK_NO_SOURCE_CHANGE`** — a rework carrying findings that changes zero source files. Catches the two re-dispatches that returned SUCCESS having changed nothing.
2. **`INCOMPLETE_PHASE_PROGRESSION`** — `completed_phases` does not contain `implement`. Catches the fresh lane that stopped at `plan` and reported completed.
3. **`IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`** — the implement phase is marked complete but no source changed. Catches a self-reported phase with no real diff, which neither of the other two can see.

`countSourceFilesChanged` excludes `docs/` and `.ops/`: a proof-only or manifest-only commit is not implementation.

**No proof-only or scope-aware exception exists.** Every lane must change real source. A lane whose declared deliverable is documentation fails closed here until UTV2-1710 supplies lifecycle-owned deliverable authority.

## Why the proof-only exception was removed rather than repaired

It was attempted at bounce 1 and removed at bounce 2 by PM scope decision, after review found it had introduced two further false-success paths:

- `declaredDeliverableChanged` was counted **after** `writeModelRoutingEvidence()` and `commitAndPushEvidence()`, so the runner's own mandatory artifact made the count positive even when the executor changed nothing. The guard was measuring its own harness.
- `countDeclaredDeliverableChanged` used raw prefix matching, so an exact lock of `docs/result.md` also credited `docs/result.md.bak`, and stripping the glob from `dir/*` credited nested descendants the canonical scope matcher excludes.

It was also unreachable for the lanes it claimed to serve: it required a trusted manifest on the base ref, which ordinary `ops:lane-start` never establishes for a new lane. The positive regressions manufactured that state; production could not reach it, while both defects above were reachable on any lane whose scope included its proof directory.

Three attempts, three distinct false-success paths, all entering through the same door — a special case deciding when changing nothing is acceptable. A lane whose purpose is preventing false success may not have that door.

A regression asserts the **production call site**, not only the functions — the function being correct does not stop one line in `main()` from bypassing it, which is exactly how defect 1 shipped. A second guard asserts the removed surface is absent rather than merely unused.

## Three defects found in review, all in the orchestrator's own addition

1. The rule was fed a **pre-spawn** phase snapshot, always `orient` on a fresh lane, so every first-attempt dispatch would have failed. Fixed by removing the parameter, not by adding a test — a test could not guard a wrong call site.
2. `checkpoint.phase` is the **next** phase to work on, not the ending phase, so a run that completed `plan` would have passed. Fixed by gating on `completed_phases`.
3. `completed_phases` is **written by the executor**, so claiming `implement` with no diff passed. Fixed by corroborating the claim against a real diff.

## Mutation results

| Mutation | Result |
|---|---|
| A · Rule 2, completed-phases removed | `not ok 25` — 55 pass / 1 fail |
| B · Rule 1, rework removed | `not ok 22`, `28` — 54 pass / 2 fail |
| C · gate on `checkpoint.phase` | `not ok 25` — 55 pass / 1 fail |
| D · Rule 3, self-attestation cross-check removed | `not ok 26` — 55 pass / 1 fail |
| E · dry-run purity removed | `not ok 29` — 55 pass / 1 fail |
| F · source counting includes `docs/`, `.ops/` | `not ok 24` — 55 pass / 1 fail |
| G · call site stops passing `issueId` | `not ok 30` — 55 pass / 1 fail |
| H · proof-only exemption reintroduced | `not ok 31` — 55 pass / 1 fail |
| Restored | **56 / 56** across both modules, 0 skipped |

Eight groups, no survivors.

## Known limitations, deliberately not addressed here

- `pnpm type-check` does not compile `scripts/ops/**`; `tsconfig.json` references only `packages/*` and `apps/*`. Tracked under a separate ticket per PM sequencing.
- A legitimate no-op run stays fail-closed per PM decision. A future `NO_CHANGE_REQUIRED` disposition with independent confirmation is required, and must never masquerade as SUCCESS.
- A legitimately proof-only lane also fails closed here. That is a known, accepted cost until UTV2-1710 provides lifecycle-owned deliverable authority. A visible false failure is recoverable; a false success is not.
