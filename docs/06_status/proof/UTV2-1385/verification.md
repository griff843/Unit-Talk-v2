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

## pnpm test:db

Branch HEAD SHA: 78611ecfd7a4adc1f0601bf5654c62105c491fa0

```text
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 117962.37441
```

## Merge SHA

Merged to main: `0ef12822ea88c8db9a2f95dff78bd1df77f170ed`
