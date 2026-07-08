## Summary

UTV2-1492 fixes a genuine lane-lifecycle contradiction: a fresh T1 lane could never pass `pnpm ops:preflight` because `PX5` required the T1 proof directory to already exist on disk, but the instant it existed, `PX3`/`PX4` (both non-waivable for T1) demanded populated, SHA-bound `pnpm test:db` evidence in it — evidence that cannot exist before any implementation has happened. This was rejected once already as a Codex attempt (PR #1175, closed) that only made the `pnpm test:db` requirement conditional on tier without removing the underlying contradiction for T1. This PR implements the actual fix, per PM decision 2026-07-08.

## Evidence

Branch: `claude/utv2-1492-preflight-proof-lifecycle`
Pre-commit SHA binding: `121cdd8f775e0593af2e8f3dc6f5628efdcaec1d`

Changed files (scope exactly matches the declared `file_scope_lock`):

- `scripts/ops/preflight.ts` — removed `PX3` (proof-auditor-gate), `PX4` (runtime-verifier-gate), and `PX5` (T1 proof-dir existence) from `runGateEquivalentChecks` entirely. Preflight no longer shells out to `proof-auditor-gate.ts` or `runtime-verifier-gate.ts`. `PX1` (verify:quick) and `PX2` (branch discipline) are unchanged.
- `scripts/ops/lane-start.ts` — after manifest creation: (a) guards against a T1 lane declaring zero `expected_proof_paths` (the new home for PX5's intent, now checked against a manifest that actually exists at this point, not a bare directory check pre-manifest); (b) scaffolds the empty proof directory (`docs/06_status/proof/<issue>/.gitkeep`) inside the lane worktree, committed alongside the manifest and sync file, so no operator/executor ever needs to hand-create it before preflight.
- `scripts/ops/preflight.test.ts` — added regression tests asserting PX3/PX4/PX5 and the gate-script shell-outs are gone, and that `WAIVABLE_CHECKS` doesn't reference them.
- `scripts/ops/lane-start.test.ts` (new) — added regression tests asserting the T1 empty-proof-paths guard exists, the proof directory is scaffolded in the worktree, and explicitly that it is NOT scaffolded in the main checkout (which must stay clean/control-plane-only per PG2).

**Not touched** (per explicit AC and PM guardrails): `proof-gate.yml`, `truth-check-lib.ts`, `lane-close.ts`, `merge-gate.yml`. Proof/runtime evidence content validation remains exactly where it already correctly lives — `proof-gate.yml` (CI on `pull_request`, after a real diff exists) and `truth-check-lib.ts`'s `runTruthCheck` (invoked by `ops:lane-close`, gated behind `manifest.status ∈ {merged, done}`).

## Verification

Verification is recorded in `docs/06_status/proof/UTV2-1492/verification.md`, including a review packet explaining the new T1 lifecycle.

## Merge SHA binding

Head SHA: 225018bceb28105bbe8580ace4266bd6ac2cf0ba
Merge SHA: 21ad35f905af6fdd8ffa88a8de7e8b7bd24eed97
