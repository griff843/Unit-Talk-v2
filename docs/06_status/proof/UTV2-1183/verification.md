# UTV2-1183 — Verification Log

## Summary

CR-4 — Enforce Terminal Rollback Replay States. Added `TERMINAL_ROLLBACK_STATUSES`, `isTerminalRollbackStatus()`, `assertRollbackStateNotTerminal()`, and `RollbackTerminalStateError` to `governance-rollback.ts`. `replayRollbackChain()` now breaks on first terminal state, preventing `applied`/`rejected`/`expired` from being overwritten by subsequent events.

## Verification

Branch SHA: `bf0279e5c81eebce7bebc27cccdcf34d68178697`

### pnpm verify

```
pnpm verify — PASS
# tests 653
# pass 653
# fail 0
# cancelled 0
# skipped 0
```

All workspace packages passed: env:check, lint, type-check, build, test.

### T1 Proof Tests

```
tsx --test apps/api/src/t1-proof-utv2-1183-terminal-rollback-states.test.ts

1..19
# tests 19
# pass 19
# fail 0
# duration_ms 511
```

19/19 adversarial assertions covering TRS-1 through TRS-9.

### pnpm test:db

```
1..7
# tests 7
# pass 7
# fail 0
# duration_ms 28727
```

7/7 live-DB smoke tests against real Supabase (project ref: zfzdnfwdarxucxtaojxm).

### R-level compliance

```
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
```
