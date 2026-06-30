# UTV2-1385 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1385-promotion-target-check-sync`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsx scripts/ci/check-promotion-target-sync.ts` | PASS | Confirmed `promotionTargets` and `picks_promotion_target_check` both contain `[best-bets, trader-insights, exclusive-insights]`. |
| `pnpm type-check` | PASS | TypeScript project references completed successfully. |
| `pnpm test` | PASS | Root aggregate `node:test`/`tsx --test` suite completed successfully. |
| `pnpm verify` | PASS | Full static gate plus live DB smoke and live T1 proof suite completed successfully. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | No R-level rules matched this diff. |

Issue-specific output:

```text
[promotion-target-sync] PASS
Canonical targets: [best-bets, trader-insights, exclusive-insights]
Constraint 00000000000000_baseline_live_schema.sql: [best-bets, trader-insights, exclusive-insights]
```

R-level lookup:

- `docs/05_operations/r1-r5-rules.json` has no rule matching `scripts/ci/check-promotion-target-sync.ts`.
- Required R-level artifacts: N/A.

R-level command output:

```text
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```
