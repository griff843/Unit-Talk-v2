# UTV2-1070 Verification

Date: 2026-05-21
Branch: `codex/utv2-1070-pnpm-state-isolation`

## Commands

- PASS - `pnpm type-check`
- PASS - `pnpm test`
- PASS - issue-specific verification
- PASS - `pnpm verify`
- INFRA - `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
- PASS - `node --import tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

## Issue-Specific Verification

Static smoke check:

```text
node - <<'NODE'
...
lane-start pnpm state isolation markers present
NODE
```

The smoke check asserted that `scripts/ops/lane-start.ts` contains the worktree-local `.out/pnpm-state` root, both uppercase and lowercase pnpm cache/store/state environment variables, `PNPM_HOME`, `COREPACK_HOME`, and the isolated runner used by lane setup installs.

## R-Level Compliance

Opened `docs/05_operations/r1-r5-rules.json`; none of its rules match the intended UTV2-1070 file scope (`scripts/ops/lane-start.ts`, proof files).

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` failed before script execution because the sandbox rejected the tsx CLI IPC socket:

```text
Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe
```

Equivalent execution through Node's tsx loader succeeded:

```text
node --import tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 0
Rules matched: (none) — no R-level artifacts required for this diff
```

The R-level script compares committed refs, so the pre-commit run saw zero committed changed files. The manual rules lookup above confirms no R-level rule applies to the intended lane-start/proof-file scope.

## Verify Tail

```text
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1070-pnpm-state-isolation/apps/discord-bot/command-manifest.json
[check-migration-versions] 107 migration file(s) verified — no duplicate versions.
[lint-migrations] 107 migration file(s) checked — no findings.
```

## Test Summary

- `pnpm test`: 481 tests passed, 0 failed.
- Smart Form verify inside `pnpm verify`: 113 tests passed, 0 failed.
