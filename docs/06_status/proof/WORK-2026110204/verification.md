# PROOF: WORK-2026110204

MERGE_SHA: pending merge

Issue: WORK-2026110204
Tier: T2
Lane type: governance
Executor: codex-cli, launched by Production Claude through `pnpm ops:codex-exec --issue WORK-2026110204`
result: local_static_pass

## ASSERTIONS:

- [x] `buildCodexChildEnv` sets `UNIT_TALK_EXECUTION_CHECKPOINT_DIR` to the directory it is given. `main()` passes `path.dirname(attemptStart.path)`, the directory holding the checkpoint file that `beginAttempt` just wrote (`Codex child environment carries the checkpoint directory and originating identity`).
- [x] `phase-complete` run from inside a separate lane repository, with the environment `buildCodexChildEnv` produced, lands in the launch root's checkpoint directory and not in the lane repository's (`phase-complete from a separate lane repository writes into the launch checkpoint directory`).
- [x] The `execution-checkpoint` CLI resolves `--dir`, then a non-empty `UNIT_TALK_EXECUTION_CHECKPOINT_DIR`, then `EXECUTION_CHECKPOINT_DIR`. Each case is tested by running the real CLI as a child process (`... uses environment directory when --dir is absent`, `... gives --dir precedence over its environment directory`, `... retains repository default when neither directory override is set`).
- [x] The launch-root refusal and `checkpointRootMismatch` are removed. `grep -rn checkpointRootMismatch scripts/` returns nothing.
- [x] Every temporary directory the changed tests allocate is released in a `finally` block.

## EVIDENCE:

Source under test is `dc2c2d384e3b7f467b93e3b7e29eb7b2fcd08206`. `git diff --quiet dc2c2d384 HEAD -- scripts/` is clean. The later commits touch only `docs/06_status/proof/WORK-2026110204/`.

Mutation checks were run by Production Claude on `dc2c2d384e3b7f467b93e3b7e29eb7b2fcd08206`. Each was applied alone, then `npx tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts` was run, then the file was restored from a copy. `git status --short scripts/` was clean afterwards.

```text
M1 buildCodexChildEnv omits the variable     -> not ok 15, not ok 54   # pass 87 # fail 2
M2 runCli ignores the environment variable   -> not ok 54, not ok 55   # pass 87 # fail 2
M3 environment variable wins over --dir      -> not ok 56              # pass 88 # fail 1
```

Model routing: `model-routing.json` was written and pushed by `codex-exec` after the Codex child exited. It records:
- `routing_source: "declared"`, `codex-luna-medium` / `gpt-6-luna` / `medium`;
- `observation.status: "observed"`, from a single rollout: session `01a19c68-d55a-7dd0-8d98-a48f159acd20`, model `gpt-6-luna`, effort `medium`, CLI `0.162.1`, 1 turn;
- `mismatched_fields: []` and `unavailable_fields: []`.

The wrapper's JSON result reported `observation_status: "observed"`. Correction: the first version of this file was written by the Codex child during its run. It said the rollout was unavailable, and that was wrong. The observation is made by the parent after the child exits, so the child cannot see it. `model-routing.json` is the record.

## Verification

Run by Production Claude on `dc2c2d384e3b7f467b93e3b7e29eb7b2fcd08206`:

- [x] `npx tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts`: `# tests 89`, `# pass 89`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed over the 118 node:test blocks: `# tests 7779`, `# pass 7766`, `# fail 0`, `# skipped 13`. No line began with `not ok`.
- [x] `npx eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.ts scripts/ops/execution-checkpoint.test.ts`: exit 0.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base d764e0976e23c577f58e21d5150c6dbb6f751951 --head dc2c2d384`: `Verdict: PASS`, `Changed files: 10`, `Rules matched: (none)`. The base is the merge base. Comparing two-dot against the newer origin/main also counts files from another merged PR.
- [x] Type-check: `pnpm type-check` does not cover `scripts/`. A direct `npx tsc -p <tsconfig extending tsconfig.base.json, files: the two changed scripts/ops sources>` reports 36 errors both on the merge base `d764e0976` and on `dc2c2d384`. The error sets are identical apart from line numbers, so there are no new errors.
- [ ] `pnpm verify` runs in protected CI on the PR head. It cannot exit 0 locally, because `ci:assert-staging` refuses a non-staging target (`[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx`).

Not done: no Codex Desktop registration, no change to the packet's default handoff, and no automatic review or merge. All are out of scope per the work order.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1821
Execution SHA: dc2c2d384e3b7f467b93e3b7e29eb7b2fcd08206
