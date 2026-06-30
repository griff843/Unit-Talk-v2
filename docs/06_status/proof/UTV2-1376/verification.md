# UTV2-1376 Verification

## Verification

- `npx tsx --test scripts/ops/runtime-verifier-gate.test.ts` - failed before the patch on the missing-SHA regression case, then passed after the patch with 9 tests passing.
- `npx tsx --test scripts/ops/proof-auditor-gate.test.ts` - passed with 16 tests passing; confirms the adjacent auditor gate behavior was not changed.
- `pnpm type-check` - passed.
- `pnpm test` - passed.
- Issue-specific runtime verifier check: proof file with no SHA at all → `Verdict: FAIL` (`no SHA binding found`); proof file containing a 40-char hex SHA → `Verdict: PASS`. The branch HEAD SHA check remains advisory (warning only) — circular dependency: SHA is only known after commit; post-merge SHA enforcement is in `ops:truth-check` P3/C4. Branch HEAD SHA for this lane: `4fe55747470ca138f6c6070a2c82f2db8e24039e`.
- `pnpm verify` - passed on the second full run, including live DB smoke and T1 live proof suites.

### pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17615.145693
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15238.483534
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 20960.277165
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 22636.037733
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 5182.671592
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 20922.123241
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17975.234342
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 106732.611324
```

## R-level compliance — scripts/ci/r-level-check.ts

```
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

## Notes

- The live proof suite emitted known stranded-pick warnings from existing live state; the related subtests passed.
- No `test:db`-requiring source files were changed, but `pnpm verify` includes the live DB proof gate and it completed successfully.

## Merge SHA

Merged to main: `308470064c61187e3c910e31d89dd5f2d0731bdb`
