# PROOF: WORK-2026110203

MERGE_SHA: pending merge

Issue: WORK-2026110203
Tier: T2
Lane type: governance
result: local_static_pass

## ASSERTIONS:

- [x] `codex-exec` reads the observed model routing from the Codex rollout file for this worktree and attempt. It matches on `session_meta.cwd`, `originator: codex_exec` and the session start within the attempt window. The observation records `session_id`, `model`, `reasoning_effort`, `cli_version`, `turns` and `total_tokens` (`observed routing comes from the single rollout of this worktree and attempt`).
- [x] No rollout, or more than one, gives `status: "unavailable"` with a reason. Every observed value is `null` and listed in `unavailable_fields`, and no declared value is copied into an observed field (`no rollout or several rollouts is unavailable, ...`).
- [x] A field missing from the rollout is `null` and listed, while the rest are still observed (`a field the rollout does not carry is null and listed, ...`).
- [x] A turn whose model or effort differs from the declared routing gives `status: "mismatch"` (`any turn whose model or effort differs ...`). `main()` then refuses with `ROUTING_MISMATCH` after the evidence persists and before `SUCCESS` can be reached (`a routing mismatch is reported after evidence persists ...`).
- [x] The declared top-level evidence fields keep their meaning and are labelled `routing_source: "declared"`. An evidence file built without an observation records it as unavailable (`evidence labels its routing fields as declared ...`).
- [x] The `SUCCESS` result reports the lane PR through `gh pr view` and `git rev-parse` only. It posts nothing (`observePullRequest reports the lane PR read-only, ...`). Executor-result publication stays an orchestrator step.

## EVIDENCE:

The observer was run on real data, against the 2026-11-01 `codex exec` rollout of WORK-2026103006, whose declared routing is `codex-sol-medium` / `gpt-6.1-sol` / `medium`:

```text
1 rollout(s)
{"status":"observed","reason":null,"session_id":"01a19881-002d-75e2-afea-6fa3cf13c82d","model":"gpt-6.1-sol","reasoning_effort":"medium","cli_version":"0.162.1","turns":1,"total_tokens":8370986,"unavailable_fields":[],"mismatched_fields":[]}
```

Mutation checks on `642f9a2e17479d311872d5c19bb0c741578fecf4`. Each mutation was applied alone to `scripts/ops/codex-exec.ts`, then `npx tsx --test scripts/ops/codex-exec.test.ts` was run, then the file was restored with `git checkout`:

```text
M1 originator filter removed            -> not ok 47  # pass 52 # fail 1
M2 effort mismatch check removed        -> not ok 50  # pass 52 # fail 1
M3 partial unavailable list emptied     -> not ok 49  # pass 52 # fail 1
M4 unavailable copies a model value     -> not ok 48, not ok 51  # pass 51 # fail 2
M5 main mismatch refusal removed        -> not ok 53  # pass 52 # fail 1
```

## Verification

Run on `642f9a2e17479d311872d5c19bb0c741578fecf4`:

- [x] `npx tsx --test scripts/ops/codex-exec.test.ts`: `# tests 53`, `# pass 53`, `# fail 0`, `# skipped 0`.
- [x] `npx tsx --test scripts/ops/truth-check-lib.test.ts scripts/ops/model-routing.test.ts`: `# tests 203`, `# pass 203`, `# fail 0`. That includes the CEP-conformant model-routing sidecar tests.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals: `# tests 7770`, `# pass 7757`, `# fail 0`, `# skipped 13`.
- [x] Type-check: `pnpm type-check` does not cover `scripts/`. A direct `npx tsc -p <tsconfig extending tsconfig.base.json, files: the two changed scripts/ops files>` reports the same 4 `exactOptionalPropertyTypes` errors as `origin/main` `0c064e586`, at lines this lane did not touch. It reports no new errors.
- [x] `npx eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts`: exit 0.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [ ] `pnpm verify` runs in protected CI on the PR head. It cannot exit 0 locally, because `ci:assert-staging` requires the CI environment.

Not done: this lane launched no Codex job. Codex Desktop registration (`launch_mode`) and automatic review or merge are out of scope, per the work order.

## Merge SHA Binding

Merge SHA: pending merge
PR: set when the PR opens
Execution SHA: 642f9a2e17479d311872d5c19bb0c741578fecf4
