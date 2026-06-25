# UTV2-1308 Verification

## Verification

Issue: UTV2-1308
Tier: T3
Branch: `griffadavi/utv2-1308-g-const-12-tripwire-monitor-parity-with-ratified-section-5`

Commands run:

- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm verify` — PASS
  - Static gate completed: sync/alignment/automation/env/lint/type-check/build/test/smart-form/commands.
  - Live DB gate completed: `pnpm test:db` passed 7/7.
  - Live T1 proof gate completed through the bounded-dedup proof.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS
  - `Verdict: PASS`
  - `Rules matched: (none) — no R-level artifacts required for this diff`

## pnpm test:db

Run against project `zfzdnfwdarxucxtaojxm`:

```
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
# duration_ms 120110.460037
```

## Coverage

- Hot-table autovacuum/analyze and size checks now cover:
  - `system_runs`
  - `raw_payloads`
  - `odds_snapshots`
  - `provider_offer_history`
  - `game_results`
- Size thresholds now match the ratified Section 5 default posture:
  - `system_runs`: 500 MB
  - all other hot tables in this monitor: 300 MB
- Statement timeout detection now alerts on the maximum one-hour window over the last six hours, with default threshold `> 3/hour`.
- TOAST bloat check now covers `raw_payloads` and `odds_snapshots` at the ratified `> 80%` threshold.

## Notes

- No live data mutation was added by this lane.
- The full `pnpm verify` output included known live proof stranded-pick warnings during UTV2-1018 proof execution; those proof subtests passed and no remediation was performed in this lane.
