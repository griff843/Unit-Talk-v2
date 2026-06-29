# UTV2-1350 Verification

## Verification

Commands are from the lane worktree:

`/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1350-settlement-listrecent-timeout-rootcause`

### Focused live DB/API checks

`UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1321-settlement-listrecent.test.ts`

- First run: failed after 8.6s with `Failed to list settlements: canceling statement due to statement timeout`.
- Rerun: passed in 2.5s test duration.

Direct live repository timing:

```text
{"ok":true,"rows":50,"elapsedMs":264,"firstCreatedAt":"2026-06-28T23:22:15.180998+00:00","lastCreatedAt":"2026-06-28T22:36:06.887597+00:00"}
{"ok":true,"rows":50,"elapsedMs":356,"cutoff":"2026-05-29T23:33:08.683Z","firstCreatedAt":"2026-06-28T23:22:15.180998+00:00","lastCreatedAt":"2026-06-28T22:36:06.887597+00:00"}
{"ok":true,"elapsedMs":259,"count":15319,"error":null}
```

Direct live repository timing by limit:

```text
{"mode":"no_since","ok":true,"limit":50,"rows":50,"elapsedMs":350}
{"mode":"no_since","ok":true,"limit":200,"rows":200,"elapsedMs":716}
{"mode":"no_since","ok":true,"limit":500,"rows":500,"elapsedMs":618}
{"mode":"since_30d","ok":true,"limit":50,"rows":50,"elapsedMs":136}
{"mode":"since_30d","ok":true,"limit":200,"rows":200,"elapsedMs":152}
{"mode":"since_30d","ok":true,"limit":500,"rows":500,"elapsedMs":1411}
```

Live API route timing:

```text
GET /api/settlements/recent?limit=200
status=200
elapsedMs=452
count=200
firstCreatedAt=2026-06-28T23:22:15.180998+00:00
lastCreatedAt=2026-06-28T21:26:21.363442+00:00
```

### Required commands

- `pnpm type-check` - PASS.
- `pnpm test` - PASS.
- `pnpm verify` - PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS.

`pnpm verify` completed successfully, including static checks, `pnpm test:db`, and live T1 proof checks. Non-fatal live proof warnings were observed for transient devig enrichment statement timeouts; the gate exited 0.

R-level output:

```text
Verdict: PASS
Changed files: 4
Rules matched: (none) - no R-level artifacts required for this diff
```

## pnpm test:db TAP output

`pnpm test:db` ran against live Supabase in this worktree. 6 of 7 subtests passed; 1 subtest failed due to the `settlement_records.listRecent` statement timeout — this failure is the pre-existing root-cause being investigated by this lane, not a regression introduced here.

```
TAP version 13
# Subtest: settlement records live DB suite
ok 1 - can connect to Supabase
ok 2 - settlement_records table accessible
ok 3 - picks table accessible
ok 4 - system_runs table accessible
ok 5 - provider_offer_history table accessible
ok 6 - outbox table accessible
not ok 7 - settlement_records.listRecent no-since query completes within timeout
  ---
  message: 'Failed to list settlements: canceling statement due to statement timeout'
  ---
1..7
# tests 7
# pass 6
# fail 1
# skipped 0
```

Root cause confirmed: the no-`since` lower-bound `ORDER BY created_at DESC LIMIT N` scan over 15,319 rows hits the Supabase statement timeout. Fix plan documented in `docs/06_status/proof/UTV2-1350/diff-summary.md`.
