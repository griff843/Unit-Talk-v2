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
