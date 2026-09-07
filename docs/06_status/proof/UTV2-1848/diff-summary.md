# DIFF SUMMARY: UTV2-1848 — enforce the deferred T1 live-DB precondition at closeout

MERGE_SHA: pending merge
Execution SHA: e8c51d0aa

## What changed

| File | Change |
|---|---|
| `scripts/ops/shared.ts` | `T1_LIVE_DB_PRECONDITION_DEFERRED` + `T1LiveDbPrecondition`; optional `LaneManifest.t1_live_db_precondition`; two `validateManifest` rules — an unrecognised value is refused, and the field is refused at any tier other than `T1` |
| `scripts/ops/truth-check-lib.ts` | `T1_DEFERRAL_RECEIPT_CONTEXTS`, `evaluateT1LiveDbPreconditionDeferral`, and the `G6` wiring in the truth-check run |
| `scripts/ops/shared.test.ts` | 4 `validateManifest` tests |
| `scripts/ops/truth-check-lib.test.ts` | 7 tests, including one asserting `G6` is wired rather than merely exported |
| `docs/05_operations/TRUTH_CHECK_SPEC.md` | `G6` in the GitHub-checks table plus §4.2 semantics |
| `docs/05_operations/LANE_MANIFEST_SPEC.md` | `t1_live_db_precondition` in §4.3 Optional Fields plus its refusal rules |
| `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` | §6a — what landed, the mutation evidence, and the exact remaining admission diff |
| `docs/06_status/proof/UTV2-1848/.gitkeep` | deleted — unsatisfiable by construction |

## What it does not change

No `.github/workflows/**` file, no CODEOWNERS, no branch-protection setting, no tier semantics, no
approval artifact, and no change to what `verify` requires. `git diff origin/main --name-only --
.github/` is empty.

Nothing writes `t1_live_db_precondition`, so `G6` reports `skip` on every lane that exists. This
diff admits nothing and refuses nothing that was previously allowed; it adds a fail-closed
obligation that activates only if PM later takes the reserved admission decision.

## Why the `.gitkeep` was deleted

`ops:lane-start` creates `docs/06_status/proof/<ID>/.gitkeep` and commits it. `Return review packet`
then rejects it as out-of-scope unless it is declared in `expected_proof_paths`, and `CEP-E2`
refuses it once it is declared — while `expected_proof_paths` is settable only at `create`. The file
is unsatisfiable in both directions and holds nothing; the directory is carried by the two declared
proof files.
