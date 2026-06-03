## Summary

UTV2-1196 closes the D-CONST-4 string-bound proof gap for T1 DB proof coverage by binding C2 to actual DB smoke execution and adding a self-test for string-only proof rejection.

## Evidence

Focused proof-auditor regression:

```text
npx tsx --test scripts/ops/proof-auditor-gate.test.ts
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

TypeScript project references:

```text
pnpm type-check
Exit code: 0
```

Full test gate:

```text
pnpm test
Exit code: 0
```

Full repository gate:

```text
pnpm verify
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1196-sprint-proof-gate-execution-bound-004/apps/discord-bot/command-manifest.json
[check-migration-versions] 117 migration file(s) verified - no duplicate versions.
[lint-migrations] 117 migration file(s) checked - no findings.
Exit code: 0
```

R-level compliance:

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 10
Rules matched: (none) - no R-level artifacts required for this diff
```

Proof capture HEAD: `e71f66dd8d18547119444c7aa74b4aefa7da43ae`

## Verification

Required packet commands:

- `pnpm type-check`: PASS
- `pnpm test`: PASS
- Issue-specific verification, `npx tsx --test scripts/ops/proof-auditor-gate.test.ts`: PASS
- `pnpm verify`: PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS
