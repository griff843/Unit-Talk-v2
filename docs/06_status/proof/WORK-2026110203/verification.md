# PROOF: WORK-2026110203

MERGE_SHA: pending merge

Issue: WORK-2026110203
Tier: T2
Lane type: governance
result: local_static_pass

## ASSERTIONS:

- [x] `codex-exec` reads the observed model routing from the Codex rollout file for this worktree and attempt. It matches on `session_meta.cwd`, `originator: codex_exec` and the session start within the attempt window. The observation records `session_id`, `model`, `reasoning_effort`, `cli_version`, `turns` and `token_usage` (`observed routing comes from the single rollout of this worktree and attempt`).
  - `token_usage` is Codex's cumulative `total_token_usage`, copied verbatim.
  - Its `total_tokens` includes cached input, so it is kept with its breakdown rather than reported as a single figure.
- [x] No rollout, or more than one, gives `status: "unavailable"` with a reason. Every observed value is `null` and listed in `unavailable_fields`, and no declared value is copied into an observed field (`no rollout or several rollouts is unavailable, ...`).
- [x] A field missing from the rollout is `null` and listed, while the rest are still observed (`a field the rollout does not carry is null and listed, ...`).
- [x] A turn whose model or effort differs from the declared routing gives `status: "mismatch"` (`any turn whose model or effort differs ...`). `main()` then refuses with `ROUTING_MISMATCH` after the evidence persists and before `SUCCESS` can be reached (`a routing mismatch is reported after evidence persists ...`).
- [x] The declared top-level evidence fields keep their meaning and are labelled `routing_source: "declared"`. An evidence file built without an observation records it as unavailable (`evidence labels its routing fields as declared ...`).
- [x] The `SUCCESS` result reports the lane PR through `gh pr view` and `git rev-parse` only. It posts nothing (`observePullRequest reports the lane PR read-only, ...`). Executor-result publication stays an orchestrator step.
- [x] A launch from a checkout whose repository root differs from the lane worktree's root is refused with `PRECONDITION_FAILED` (exit 2) before spawning. The refusal prints `cd <worktree> && pnpm ops:codex-exec --issue <ID>` (`checkpointRootMismatch flags ...`, `codex-exec refuses before spawning when launched outside the lane worktree root`).
  - Without the refusal, the child's phase records land under the worktree's root while the parent reads the launch root's checkpoint. WORK-2026110201 ended `INCOMPLETE_PHASE_PROGRESSION` that way on 2026-11-02.

## EVIDENCE:

The observer was run on real data, against two `codex exec` rollouts.

WORK-2026103006 (2026-11-01). Declared routing: `codex-sol-medium` / `gpt-6.1-sol` / `medium`.

```text
1 rollout(s)
{"status":"observed","reason":null,"session_id":"01a19881-002d-75e2-afea-6fa3cf13c82d","model":"gpt-6.1-sol","reasoning_effort":"medium","cli_version":"0.162.1","turns":1,"token_usage":{"input_tokens":8344282,"cached_input_tokens":8227968,"cache_write_input_tokens":0,"output_tokens":26704,"reasoning_output_tokens":8740,"total_tokens":8370986},"unavailable_fields":[],"mismatched_fields":[]}
```

WORK-2026110201 (2026-11-02, the first wrapper run under the hybrid model). Declared model and effort: `gpt-6-luna` / `medium`.

```text
1 rollout(s)
{"status":"observed","reason":null,"session_id":"01a19bab-6cd9-7252-90a7-a6bbc29ed0ad","model":"gpt-6-luna","reasoning_effort":"medium","cli_version":"0.162.1","turns":1,"token_usage":{"input_tokens":9970678,"cached_input_tokens":9801856,"cache_write_input_tokens":0,"output_tokens":18783,"reasoning_output_tokens":5869,"total_tokens":9989461},"unavailable_fields":[],"mismatched_fields":[]}
```

Mutation checks on `0ed9dc5f0d2e8df7a5e0ef9d81939a875a1390c8`. Each mutation was applied alone to `scripts/ops/codex-exec.ts`, then `npx tsx --test scripts/ops/codex-exec.test.ts` was run, then the file was restored from `HEAD`:

```text
M1 originator filter removed            -> not ok 47              # pass 54 # fail 1
M2 effort mismatch check removed        -> not ok 50              # pass 54 # fail 1
M3 partial unavailable list emptied     -> not ok 49              # pass 54 # fail 1
M4 unavailable copies a model value     -> not ok 48, not ok 51   # pass 53 # fail 2
M5 main mismatch refusal removed        -> not ok 53              # pass 54 # fail 1
M6 main root refusal disabled           -> not ok 55              # pass 54 # fail 1
M7 mismatch helper always null          -> not ok 54, not ok 55   # pass 53 # fail 2
M8 token usage read from last turn only -> not ok 47              # pass 54 # fail 1
```

## Verification

Run on `0ed9dc5f0d2e8df7a5e0ef9d81939a875a1390c8`:

- [x] `npx tsx --test scripts/ops/codex-exec.test.ts`: `# tests 55`, `# pass 55`, `# fail 0`, `# skipped 0`.
- [x] `npx tsx --test scripts/ops/truth-check-lib.test.ts scripts/ops/model-routing.test.ts`: `# tests 203`, `# pass 203`, `# fail 0`, `# skipped 0`. That includes the CEP-conformant model-routing sidecar tests.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals: `# tests 7772`, `# pass 7759`, `# fail 0`, `# skipped 13`.
  - An earlier run on `b62fa6202` failed one test: the UTV2-1949 temp-workspace guard (`every temp-directory allocation in a governed test can be released`).
  - It flagged this lane's new worktree-root fixture, which never released its temp directory.
  - Fixed in `0ed9dc5f0` by a `try`/`finally` release. The guard's own suite then passes 8/8.
- [x] Type-check: `pnpm type-check` does not cover `scripts/`. A direct `npx tsc -p <tsconfig extending tsconfig.base.json, files: the two changed scripts/ops files>` reports the same 4 `exactOptionalPropertyTypes` errors as `origin/main` `0c064e586`, on lines this lane did not change. It reports no new errors.
- [x] `npx eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts`: exit 0.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [ ] `pnpm verify` runs in protected CI on the PR head. It cannot exit 0 locally, because `ci:assert-staging` requires the CI environment.

Not done:
- This lane launched no Codex job.
- Codex Desktop registration (`launch_mode`) and automatic review or merge are out of scope, per the work order.
- Passing the checkpoint location to the Codex child, which would make the launch-root refusal unnecessary, needs `execution-checkpoint.ts`. That file is outside this lane's file scope and is a follow-up lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1820
Execution SHA: 0ed9dc5f0d2e8df7a5e0ef9d81939a875a1390c8
