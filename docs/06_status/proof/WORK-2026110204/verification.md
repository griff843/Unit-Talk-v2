# PROOF: WORK-2026110204

Issue: WORK-2026110204

Tier: T2

Execution SHA: `0907b0400fae61aa9031d5a0da18cf05429aec4b` (attempt start SHA recorded by `ops:exec-checkpoint status`).

## ASSERTIONS

- `buildCodexChildEnv` passes through the parent checkpoint directory; the unit assertion and cross-repository subprocess test cover omission of the variable (M1).
- The real checkpoint CLI writes `phase-complete` under the environment directory when `--dir` is absent (M2).
- `--dir` takes precedence over the environment directory (M3).
- With neither override present, the CLI continues to read the repository default.
- The refusal and `checkpointRootMismatch` implementation/tests are removed.
- Every test-created temporary workspace in the touched test files is removed in `finally`.

## Verification

### Focused tests

Command: `npx tsx --test scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.test.ts`

```text
1..89
# tests 89
# suites 0
# pass 89
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 11191.271931
FOCUSED_EXIT=0
```

### ESLint

Command: `npx eslint scripts/ops/codex-exec.ts scripts/ops/codex-exec.test.ts scripts/ops/execution-checkpoint.ts scripts/ops/execution-checkpoint.test.ts`

```text
ESLINT_EXIT=0
```

### Build and type-check

Commands: `pnpm build`; `pnpm type-check`

```text
Both commands exited 0 with no output.
```

### Full test suite

Command: `pnpm test` (run after `pnpm build`)

```text
1..8
# tests 8
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2883.200079
PNPM_TEST_EXIT=0
```

The pasted TAP block is the final block emitted by the repository command; the complete captured log contained no `not ok` or non-zero `# fail` entries.

### Static verification and R-level check

Commands: `pnpm verify:static`; `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
[db-client-boundary] OK: every site is classified and none is reachable from `pnpm test`
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=137 classified=15
[executable-wiring] verdict=PASS required_roots=verify
Environment files passed validation.
```

The test-bearing static verification output also included:

```text
# tests 226
# pass 226
# fail 0
# skipped 0
```

```text
Verdict: PASS
Changed files: 25
Rules matched: operator-ui
```

The R-level check required no additional artifacts.

The `model-routing.json` file was built with `buildModelRoutingEvidence` and `unavailableObservation` from `scripts/ops/codex-exec.ts`. The declared lane route is `codex-luna-medium`; the matching rollout was unavailable, and no observed model, effort, CLI version, turn count, or token usage was copied into observed fields.

### Required full verification and live-DB deferral

Command: `pnpm verify`

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
PNPM_VERIFY_EXIT=1
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials. The command output above records the local resolver's observed host as `127.0.0.1`; no writable DB proof is claimed.

### Mutation checks

Each mutation was applied temporarily, the targeted real test process was run, and the source was restored before the next check.

| Mutation | Command result | Failing TAP test numbers |
|---|---|---|
| M1: omit `UNIT_TALK_EXECUTION_CHECKPOINT_DIR` from `buildCodexChildEnv` | 2 tests failed, as required | 1, 2 |
| M2: ignore `UNIT_TALK_EXECUTION_CHECKPOINT_DIR` in `runCli()` | 1 test failed, as required | 1 |
| M3: let the environment directory override explicit `--dir` | 1 test failed, as required | 1 |

## Merge SHA Binding

Merge SHA: pending.

PR: pending; Production Claude opens the PR when the staging slot is free.
