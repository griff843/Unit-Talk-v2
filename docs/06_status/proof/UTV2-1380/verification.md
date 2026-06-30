# UTV2-1380 Verification

## Summary

Wires market-backed Kelly sizing into submission and promotion metadata. `metadata.kellySizing` is now populated at submission time (from market-backed real-edge probability when direct devigging is unavailable) and enriched/persisted at promotion time before readiness, risk, and band scoring. Confidence-delta remains excluded from Kelly sizing and promotion edge contribution. Kelly sizing stays `null` when required inputs (odds, market-backed real-edge probability) are absent.

## Evidence

### Issue-specific tests

- `npx tsx --test apps/api/src/t1-proof-utv2-1380-kelly-sizing-promotion-metadata.test.ts` — PASS, 8/8 (T1 proof assertions + live DB schema check)
- `npx tsx --test apps/api/src/submission-service.test.ts` — PASS, 73/73
- `npx tsx --test apps/api/src/promotion-edge-integration.test.ts` — PASS, 74/74

T1 proof TAP (8 assertions, live DB included):
```
TAP version 13
ok 1 - UTV2-1380: enrichPickAtPromotionTime produces kellySizing from market-backed realEdge + marketProbability
ok 2 - UTV2-1380: kellySizing absent on base pick → enriched scoring pick carries it, so metadataPatch includes it
ok 3 - UTV2-1380: confidence-delta realEdgeSource → no kellySizing (fail-closed)
ok 4 - UTV2-1380: missing odds → no kellySizing (fail-closed)
ok 5 - UTV2-1380: missing marketProbability → no kellySizing (fail-closed)
ok 6 - UTV2-1380: existing metadata.kellySizing is not overwritten by enrichPickAtPromotionTime
ok 7 - UTV2-1380: missing realEdge in domainAnalysis → no kellySizing (fail-closed)
ok 8 - UTV2-1380 live DB: picks.metadata readable; kellySizing shape valid where present
# [UTV2-1380 live DB] rows=50 picks with kellySizing=5 enrichment-runs=5
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1660.33245
```

Files changed:
- `apps/api/src/submission-service.ts` — derives Kelly sizing from market-backed real-edge probability when direct provider-offer devigging is unavailable
- `apps/api/src/promotion-service.ts` — enriches missing `metadata.kellySizing` before score input reads, risk scoring, and band assignment; persists enriched value with promotion metadata

Domain boundary check:
- `rg "@unit-talk/db|@unit-talk/config|apps/" packages/domain/src` — PASS; matches are historical comment references only

### pnpm test:db

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
# duration_ms 97315.782485
```

## Verification

- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm test:db` — PASS (7/7 live DB smoke tests, TAP above)
- `pnpm verify` — PASS (includes env:check, lint, type-check, build, test, test:db)
- Branch HEAD SHA: 1649f7065b2266b5eebb5796fd6c71fb6895dc4b

## R-level compliance — scripts/ci/r-level-check.ts

- Triggered rules from changed paths: `lifecycle-fsm`, `promotion-scoring`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS
- Advisory only: `r4-fault-report` missing; PM-gated advisory artifact, not required for this T2 diff
