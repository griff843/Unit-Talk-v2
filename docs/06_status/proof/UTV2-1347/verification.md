# UTV2-1347: M3 Grading Root-Cause Verification

Lane type: verification (proof-only)
Tier: T2
Branch: `claude/utv2-1347-m3-grading-root-cause-fix`
Date: 2026-06-28

## Root cause confirmed

UTV2-1345 added error detail propagation to `system_runs.details` in `apps/api/src/grading-service.ts`.

### Exact lines (grading-service.ts)

**Catch block — captures per-pick error message (lines 343–350):**
```typescript
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      options.logger?.error?.(`Grading failed for pick ${pick.id}: ${message}`);
      details.push({
        pickId: pick.id,
        outcome: 'error',
        reason: message,
      });
    }
```

**Error detail aggregation (lines 361–363):**
```typescript
  const errorDetails = details
    .filter((d) => d.outcome === 'error')
    .map((d) => ({ pickId: d.pickId, reason: d.reason }));
```

**Written to system_runs.details via completeRun (lines 370–378):**
```typescript
  await repositories.runs.completeRun({
    runId: runRecord.id,
    status: errorCount > 0 ? 'failed' : 'succeeded',
    details: {
      picksGraded: gradedCount,
      failed: errorCount,
      ...(errorCount > 0 ? { errors: errorDetails } : {}),
    },
  });
```

Note: The column that stores this data is `system_runs.details` (Json), not `metadata`. The `details` field is populated with `{ picksGraded, failed, errors: [{ pickId, reason }] }` on every grading pass completion.

## pnpm verify

**Result: FAIL (pre-existing — unrelated to this lane)**

`verify:static` component (lint + type-check + build + unit tests + verify:commands): **PASS**

`test:live-db` component: **FAIL** — 1 of 7 database smoke tests fails:

```
not ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  stack: DatabaseSettlementRepository.listRecent (runtime-repositories.ts:4393)
         → computeClvTrustAdjustment (clv-feedback.ts:45)
         → readPromotionScoreInputs (promotion-service.ts:1145)
```

Root cause of test:db failure: Supabase statement timeout on `settlement_records.listRecent` — this is the known pre-existing infrastructure bloat issue (documented in project memory `project-supabase-writepath-bloat-rootcause`). It is unrelated to grading error propagation.

### Grading-service unit tests (61 pass, 0 fail)

```
# tests 61
# suites 0
# pass 61
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2376.585111
```

Key grading tests that confirm the fix:
- `ok 36 - runGradingPass writes a grading.run system_runs row on completion`
- `ok 37 - runGradingPass writes grading.run row with failed count when errors occur`

## pnpm test:db

Full TAP output from `tsx --test apps/api/src/database-smoke.test.ts`:

```
TAP version 13
not ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 13474.602061
  failureType: 'testCodeFailure'
  error: 'Failed to list settlements: canceling statement due to statement timeout'
  code: 'ERR_TEST_FAILURE'
  ...
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  duration_ms: 24891.16579
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  duration_ms: 21380.637978
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  duration_ms: 25110.130773
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  duration_ms: 1084.054714
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  duration_ms: 23093.6553
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  duration_ms: 22188.73228
1..7
# tests 7
# suites 0
# pass 6
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 132794.677136
```

**Failure is pre-existing** (Supabase statement timeout on settlement_records, not related to grading changes).

## Live system_runs query

Query attempted:
```
GET /rest/v1/system_runs?run_type=eq.grading.run&order=created_at.desc&limit=5&select=id,run_type,status,details,created_at
```

Result:
```json
{"code": "57014", "message": "canceling statement due to statement timeout"}
```

Supabase statement timeouts affect all unbounded queries against large tables (pre-existing infrastructure issue). The system_runs table itself suffers from bloat per documented history. Cannot confirm live grading run rows due to this.

Note: confirmed correct column name is `details` (not `metadata`) per `database.types.ts` Row definition.

## M3 Verdict

**PARTIAL**

- Error detail propagation code at grading-service.ts lines 343–378 is confirmed correct: per-pick error messages are captured in catch blocks, aggregated as `errorDetails`, and written to `system_runs.details.errors` via `completeRun()`.
- Unit tests covering this path pass: 61/61 pass including test #36 (grading.run row on completion) and test #37 (grading.run row with failed count).
- Cannot confirm live DB writes due to pre-existing Supabase statement timeout (infrastructure bloat, not code regression).
- `verify:static` (lint + type-check + build + unit tests) passes completely.
- `test:db` fails 1/7 due to pre-existing infrastructure bloat on settlement_records, unrelated to grading.

Verdict is PARTIAL rather than PASS because live system_runs evidence cannot be produced (statement timeout). Code and unit-test evidence is strong.
