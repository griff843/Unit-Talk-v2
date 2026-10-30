# PROOF: WORK-2026102905

MERGE_SHA: 104185674f639dabebcef104d68b17158de5230f

Issue: WORK-2026102905
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] The "Evaluate close eligibility" step of `.github/workflows/close-eligibility-preflight.yml` resolves the lane from the branch, executed with bash exactly as written. It names `docs/06_status/lanes/<id>.json` for WORK-2026102903, UTV2-1977 and UNI-42 branches, and reports `resolves to no lane issue id` for a branch with no id.
- [x] The `proof-gate.yml` "Extract issue ID" step (T1 Proof Gate job) yields `issue_id=<id>`, `skip=false` for the same three branches and `skip=true` for the no-id branch. The "Detect issue ID" step (Runtime Verifier Gate job) yields `id=<id>`, and an empty id for the no-id branch.
- [x] Neither `proof-gate.yml` step contains `${{`; both read the branch from `env:`.
- [x] Unchanged: which checks are required, Merge Gate, ERV, lane admission, PR file reservation, the disabled `t1-proof-gate.yml` and `runtime-verifier-gate.yml`, and the other branch-resolving workflows.

## EVIDENCE:

Why: four WORK lanes needed repair after their post-merge closeout failed on a proof rule:

- WORK-2026102701 (#1789): run 40511401436
- WORK-2026102703 (#1792): run 40527619667
- WORK-2026102305 (#1779): run 40199729553
- WORK-2026102001 (#1770): run 39759694166

The probe ran `evaluateCloseEligibilityPreflight` from `scripts/ops/truth-check-lib.ts` on each PR's merged head (`git archive <head>` of the lane manifest and proof directory). It reports `eligible: false` on the rule each closeout later failed on:

```text
WORK-2026102701 @1cfa63eea  BLOCK CEP-E4/P14 verification log must reference scripts/ci/r-level-check.ts
WORK-2026102703 @a50103879  BLOCK CEP-E4/P13 verification log must reference pnpm verify
WORK-2026102305 @dbd1f0fca  BLOCK CEP-E4/P12 verification log must reference pnpm type-check and pnpm test
                            BLOCK CEP-E4/P14 verification log must reference scripts/ci/r-level-check.ts
WORK-2026102001 @3bdf6c893  BLOCK CEP-E4/P12 verification log must reference pnpm type-check and pnpm test
```

Skips observed on #1802 (head e551df146), from its CI logs:

```text
Runtime Verifier Gate: No issue ID in branch — skipping.
Close eligibility preflight: branch "claude/work-2026102903-work-lane-pr-binding" resolves to no lane issue id; not a lane PR, skipping.
```

Mutation checks. Each change was reverted alone, `--test-name-pattern "branch-resolved lane gates"` was rerun, and the file was restored:

```text
M1 close-eligibility match back to (utv2|uni)              -> pass 0, fail 1  (close-eligibility on claude/work-2026102903-work-lane-pr-binding)
M2 proof-gate Detect issue ID match back to (utv2|uni)     -> pass 0, fail 1  (proof-gate runtime-verifier on claude/work-2026102903-work-lane-pr-binding)
M3 proof-gate Extract issue ID match back to utv2          -> pass 0, fail 1  (proof-gate T1 on claude/work-2026102903-work-lane-pr-binding)
M4 proof-gate Extract issue ID template substitution restored -> pass 0, fail 1  (must read the branch from env, not template substitution)
```

## Verification

Run on `0b000e563f374e8433235c891d2cc7512c99d73a`:

- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: `# tests 95`, `# pass 95`, `# fail 0`.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0. Summed node:test totals across all files: `# tests 7682`, `# pass 7669`, `# fail 0`, `# skipped 13`.
- [x] `pnpm exec eslint scripts/ops/workflow-hardening.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no R-level artifacts required.
- [x] `pnpm ops:preflight WORK-2026102905 --tier T1 --branch claude/work-2026102905-work-branch-proof-gates --refresh`: `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT; that outcome is admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. This lane accessed no database.

Runtime: `proof-gate.yml` and `close-eligibility-preflight.yml` trigger on `pull_request` and run from the PR head. On this PR, a T1 WORK branch, T1 Proof Gate, Runtime Verifier Gate and Close eligibility therefore evaluate WORK-2026102905 instead of skipping. That is the runtime observation for this change.

Lane start used `--singleton-approved` (`.github/workflows/**` is singleton-only) as the orchestrator confirmation, after WORK-2026102903 closed (cc806b5fd).

## Merge SHA Binding

Merge SHA: 104185674f639dabebcef104d68b17158de5230f
PR: https://github.com/griff843/Unit-Talk-v2/pull/1804
Execution SHA: 0b000e563f374e8433235c891d2cc7512c99d73a
