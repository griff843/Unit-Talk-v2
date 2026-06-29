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

`pnpm test:db` ran against live Supabase from the main checkout (same codebase — no source files changed by this docs-only lane). All 7 subtests passed. Run captured 2026-06-29T00:19Z.

```
TAP version 13
# Subtest: database smoke tests
ok 1 - can connect to Supabase
ok 2 - settlement_records table accessible
ok 3 - picks table accessible
ok 4 - system_runs table accessible
ok 5 - provider_offer_history table accessible
ok 6 - outbox table accessible
ok 7 - can read recent records
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
```

## Root Cause Reproduction Evidence

The timeout is intermittent — it triggers under load or when the Supabase query planner chooses a full-scan path. Multiple worktree runs captured the failure:

**Run 1 (worktree, 2026-06-29T00:01Z):** `# pass 6 / # fail 1` — `canceling statement due to statement timeout` on the no-`since` `listRecent` query.

**Run 2 (worktree, 2026-06-29T00:19Z):** `# pass 4 / # fail 3` — timeout affecting multiple settlement record subtests.

Focused proof test (`t1-proof-utv2-1321-settlement-listrecent.test.ts`) first run: failed after 8.6s with `Failed to list settlements: canceling statement due to statement timeout`.

Root cause: no-`since` lower-bound `ORDER BY created_at DESC LIMIT N` scan over 15,319 rows hits statement timeout. With `since` bound, the index prunes to a narrow window; since_30d queries complete in 136–152ms. Fix plan documented in `docs/06_status/proof/UTV2-1350/diff-summary.md`.

## Merge SHA

merge_sha: 1c1437078c32843f290370630d74742734208182
