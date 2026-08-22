# UTV2-1732 Verification

Issue: UTV2-1732  
Tier: T1  
Lane type: governance  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1437  
Verified source SHA: `b9e7f33ca7ee0f01fb511bf9198d3dc7b03ae321`  
Generated: 2026-08-22T06:06:39Z

## Verification

- PASS — `pnpm type-check`
- PASS — `pnpm lint`
- PASS — `pnpm verify:static`
- PASS — `pnpm test` as exercised by `pnpm verify:static`; the root aggregate reported 2,340 passing tests with zero failures, followed by all package verification suites.
- PASS — focused issue suite:

  ```text
  $ pnpm exec tsx --test 'scripts/ops/claude-exec.test.ts' 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-checkpoint.test.ts' 'scripts/ops/execution-packet.test.ts' 'scripts/ops/lane-start.test.ts'
  1..126
  # tests 126
  # pass 126
  # fail 0
  ```

- PASS — `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

  ```text
  Verdict: PASS
  Changed files: 13
  Rules matched: (none) — no R-level artifacts required for this diff
  ```

- DEFERRED — `pnpm test:db` / writable live-DB proof. Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

## Contract Assertions

- PASS — lane admission captures objective, acceptance criteria, guardrails, non-goals, required evidence, exit criteria, and the exact Linear source snapshot before executor spawn.
- PASS — missing objective or acceptance criteria fails task-contract construction; missing or tampered contracts fail packet generation.
- PASS — a closed completed/rejected checkpoint accepts one operator correction brief, seals its exact content, and supplies original task plus unresolved findings and corrections to rework.
- PASS — task-contract SHA-256 and correction SHA-256 are bound to the execution epoch; resume/rework refuses mismatched contract identity.
- PASS — Claude and Codex render the same `TaskContract` through the shared prompt renderer.
- PENDING POST-MERGE — end-to-end UTV2-1729 re-dispatch and substantive changes to its two target files. Those files are deliberately outside this lane and the issue forbids folding UTV2-1729 implementation into UTV2-1732.
- PENDING POST-MERGE — independent UTV2-1729 review, UTV2-1383 recovery, and UTV2-1667 regeneration. These are downstream orchestration exit criteria, not authorable changes in this lane.

## Runtime Verification

The 126-test focused suite exercises contract capture, pre-spawn refusal, tamper refusal, prompt parity, closed-checkpoint correction admission, exact correction rendering, epoch hash binding, checkpoint-directory propagation, and legacy executor behavior. Writable database proof is deferred to staging CI as stated above; this governance-lane implementation does not change application or database runtime paths.

## Independent Review

Independent adversarial review remains mandatory and is intentionally not self-attested in author evidence. It must review the exact PR head before T1 approval.

## SHA Binding

Verified source SHA: `b9e7f33ca7ee0f01fb511bf9198d3dc7b03ae321`  
Merge SHA: not available pre-merge; post-merge closeout must rebind this artifact.
