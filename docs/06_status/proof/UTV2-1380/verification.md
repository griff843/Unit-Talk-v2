# UTV2-1380 Verification

## Verification

- `npx tsx --test apps/api/src/submission-service.test.ts` — PASS, 73/73.
- `npx tsx --test apps/api/src/promotion-edge-integration.test.ts` — PASS, 74/74.
- `rg "@unit-talk/db|@unit-talk/config|apps/" packages/domain/src` — PASS; matches are historical comment references only.
- `pnpm type-check` — PASS.
- `pnpm test` — PASS.
- `pnpm verify` — PASS, including `test:db` 7/7 and live T1 proof suite.

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

## Issue-Specific Coverage

- Submission path now writes `metadata.kellySizing` from market-backed real-edge inputs before promotion when direct devigging lookup is unavailable.
- Promotion path now enriches missing `metadata.kellySizing` before score input reads, risk scoring, and band assignment.
- Kelly sizing remains `null` when required inputs are unavailable, including missing odds or missing market-backed real-edge probability.
- Confidence-delta remains excluded from Kelly sizing and promotion edge contribution.

## R-level compliance — scripts/ci/r-level-check.ts

- Triggered rules from changed paths: `lifecycle-fsm`, `promotion-scoring`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS.
- Advisory only: `r4-fault-report` missing; PM-gated advisory artifact, not required for this T2 diff.
