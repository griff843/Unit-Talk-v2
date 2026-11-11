# Diff summary: WORK-2026110804

Lean operating mode (Standard / Protected) candidate, landed inert. No behavior change until Griff sets `OPERATING_MODEL=lean` and a past `LEAN_MODE_ACTIVATED_AT`. No branch-protection, CODEOWNERS or repository-variable change.

| File | Change |
|---|---|
| `.github/workflows/merge-gate.yml` | Lean path behind `OPERATING_MODEL=lean` (lazy module load, head-move refusal, CODEOWNER approval for non-Standard). Legacy path unchanged. Merge-gate policy input. |
| `.github/workflows/executor-result-validator.yml` | Lean Standard needs no executor result. Protected, legacy and unset-mode PRs still validated. Policy input. |
| `.github/workflows/required-check-refresh.yml` | Reruns Independent Review and Merge Gate on the trusted anchored summary, only in armed lean mode. Legacy no-op otherwise. |
| `.github/workflows/post-merge-qa-gate.yml` | In lean mode, the tier is derived from the diff (Protected -> T1). Legacy forwards the label unchanged. |
| `.github/workflows/risk-class.yml` | New check. Reports the class in lean mode and is not applicable in legacy mode. Not a required context. |
| `.github/workflows/independent-review.yml` | New check. Fails closed in lean mode without a trusted clean head-bound summary and is not applicable in legacy mode. Not a required context. |
| `scripts/ops/operating-model.cjs` | New classifier, review evaluator and shared policy loader. |
| `scripts/ops/operating-model.test.ts` | New: 32 tests. |
| `scripts/ops/operating-model-workflows.test.ts` | New: 34 tests that execute the workflow scripts. |
| `scripts/ops/workflow-hardening.test.ts` | Adds `Independent Review` to the refresh workflow's expected names. |
| `package.json` | Registers the two new test files in `test:ops`, and nothing else. |
| `docs/05_operations/LEAN_MODE_ACTIVATION.md` | New landing, activation, rollback and known-limits runbook. |
| `docs/05_operations/OPERATING_MODEL_SONNET5.md` | Adds §8, inactive until activated. |
| `.ops/work/WORK-2026110804.md` | Work order with verbatim authorization. |

## SHA Binding

Merge SHA: pending merge
PR: pending
