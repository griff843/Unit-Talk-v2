# UTV2-1300 Verification

**Issue:** UTV2-1300 — T3 read-only DB-health tripwire monitor (GHA cron from §5 of retention spec)
**Tier:** T3
**Lane type:** governance
**Branch:** griffadavi/utv2-1300-t3-read-only-db-health-tripwire-monitor-gha-cron-from-5-of
**PR:** #1060
**Merge SHA:** d81f2018959133a0c91607006ca462730190b86d

## Summary

T3 governance lane adding a read-only GHA cron monitor for DB health (autovacuum staleness, table size growth, statement timeout rate). No DB mutation. Spawned from §5 of the ratified retention spec (companion spec PR merged SHA 92124569). All execution actions (VACUUM, archival, partition) remain separately PM-gated.

## Evidence

### pnpm type-check
PASS — no TypeScript errors introduced.

### pnpm lint
PASS — no lint errors (prefer-const fix committed).

### pnpm test:db

```
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Verification

### R-Level Check (scripts/ci/r-level-check.ts)
R-level: R4 (governance lane — GHA workflow + ops script, no runtime changes). Required artifacts: verification.md. Present.

### Acceptance Criteria

| Criterion | Status |
|---|---|
| GHA workflow runs on 6h cron + manual dispatch | PASS |
| All three checks query Supabase read-only | PASS |
| Thresholds configurable via workflow env vars | PASS |
| Alert fires to Linear comment on breach | PASS |
| No write path touched | PASS |
| pnpm test:db green | PASS — 7 pass, 0 fail, 0 skipped |
