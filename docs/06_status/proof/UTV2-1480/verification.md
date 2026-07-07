# UTV2-1480 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1480-fix-workflow-config-drift`:

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project references check completed successfully. |
| `pnpm test` | PASS | Root aggregate test suite completed successfully. |
| Issue-specific workflow assertion | PASS | Parsed all four scoped workflow YAML files and asserted db-health pooler selection plus live-schema parity secret wording. |
| `pnpm verify` | PASS | Static gate, `test:db`, and live T1 proof bundle completed successfully. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files: 7; no R-level rules matched; no R-level artifacts required. |

Issue-specific assertion:

```text
UTV2-1480 issue-specific workflow config assertions: PASS
```

`pnpm verify` final live proof tail:

```text
# Subtest: UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
ok 5 - UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
# Subtest: UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
ok 6 - UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
1..6
# tests 6
# pass 6
# fail 0
```

Live DB note: `test:t1-proof:live` included one skipped bounded-dedup window-content assertion because the most recent `provider_offer_history` row was older than the 72h lookback window; the test classifies this as stale provider data, not a code regression. The command exited 0.
