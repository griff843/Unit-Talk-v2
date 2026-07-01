# UTV2-1373 — MLB Participant Upsert Timeout: withRetry

## Verification

This file is the T1 verification record for UTV2-1373 (MLB participant upsert timeout retry fix).
See sections below for metadata, assertions, and evidence.

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1373 |
| Tier | T1 |
| Phase / Gate | Implementation + T1 static proof |
| Owner | claude/utv2-1373 |
| Date | 2026-06-30 |
| Verifier Identity | claude/utv2-1373-mlb-participant-upsert-timeout |
| Commit SHA(s) | `b5f712b24c6501698dc273d52bb4185c1d6ad0a8` (merge SHA) |
| Related PRs | https://github.com/griff843/Unit-Talk-v2/pull/1134 |

## Scope

**Claims:**
- `withRetry<T>` primitive added to `cooperative.ts` with 3-total-attempt capped exponential backoff
- Predicate `isTransientParticipantUpsertTimeout` gates retry only on `statement timeout` / `canceling statement` / `57014` errors
- Both `participants.upsertByExternalId` and `eventParticipants.upsert` wrapped with `withRetry` in the hot loop
- Successful retries increment `transientRetryCount` — not `errors`
- Budget exhaustion is fail-closed (rethrow last error)
- `pnpm verify` green; all unit tests pass; `pnpm test:db` 7/7 pass

**Does NOT claim:**
- Option B (read-before-write elimination in `DatabaseParticipantRepository`) — deferred follow-up
- Post-deploy runtime proof (MLB cycle completes without timeout) — requires deploy; assembled post-merge
- Any change to team-link or event-upsert retry behavior (those do not use mapWithConcurrency)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | withRetry succeeds on second attempt when first throws retryable error | test | `cooperative.test.ts::withRetry succeeds on second attempt when first is retryable` | PASS | [E1](#e1-withretry-retry-succeeds) |
| 2 | withRetry exhausts budget and rethrows (fail-closed) | test | `cooperative.test.ts::withRetry exhausts budget and rethrows last error` | PASS | [E2](#e2-withretry-budget-exhausted) |
| 3 | withRetry rethrows non-retryable error immediately | test | `cooperative.test.ts::withRetry rethrows non-retryable error immediately` | PASS | [E3](#e3-withretry-non-retryable) |
| 4 | attempts=1 is a no-retry pass-through | test | `cooperative.test.ts::withRetry with attempts=1 is a no-retry pass-through` | PASS | [E4](#e4-withretry-attempts-1) |
| 5 | transient timeout retried, cycle completes, transientRetryCount incremented | test | `entity-resolver.test.ts::transient timeout is retried and cycle completes` | PASS | [E5](#e5-entity-resolver-retry-succeeds) |
| 6 | Permanent timeout exhausts budget; cycle fails closed | test | `entity-resolver.test.ts::budget exhausted on permanent timeout` | PASS | [E6](#e6-entity-resolver-budget-exhausted) |
| 7 | Non-retryable error not retried | test | `entity-resolver.test.ts::non-retryable error is not retried` | PASS | [E7](#e7-entity-resolver-non-retryable) |
| 8 | pnpm verify green (all tests, type-check, lint, build) | repo-truth | `pnpm verify` exit 0 | PASS | [E8](#e8-pnpm-verify) |
| 9 | pnpm test:db green (live Supabase, 7/7 pass) | test | `apps/api/src/database-smoke.test.ts` | PASS | [E9](#e9-pnpm-test-db) |

## Evidence Blocks

### E1 withRetry retry succeeds

**Test evidence**
Test: `apps/ingestor/src/cooperative.test.ts::withRetry succeeds on second attempt when first is retryable`
Command: `tsx --test apps/ingestor/src/cooperative.test.ts`
Output excerpt:
```
ok 11 - withRetry succeeds on second attempt when first is retryable
  ---
  duration_ms: 3.2
  type: 'test'
```

### E2 withRetry budget exhausted

**Test evidence**
Test: `apps/ingestor/src/cooperative.test.ts::withRetry exhausts budget and rethrows last error (fail-closed)`
Output excerpt:
```
ok 12 - withRetry exhausts budget and rethrows last error (fail-closed)
  ---
  duration_ms: 3.6
  type: 'test'
```
Assertion: `assert.equal(calls, 3)` confirms all 3 attempts fired.

### E3 withRetry non-retryable

**Test evidence**
Test: `apps/ingestor/src/cooperative.test.ts::withRetry rethrows non-retryable error immediately without using remaining budget`
Output excerpt:
```
ok 13 - withRetry rethrows non-retryable error immediately without using remaining budget
  ---
  duration_ms: 0.5
  type: 'test'
```
Assertion: `assert.equal(calls, 1)` — single attempt only.

### E4 withRetry attempts=1

**Test evidence**
Test: `apps/ingestor/src/cooperative.test.ts::withRetry with attempts=1 is a no-retry pass-through`
Output excerpt:
```
ok 14 - withRetry with attempts=1 is a no-retry pass-through
  ---
  duration_ms: 0.2
  type: 'test'
```

### E5 entity-resolver retry succeeds

**Test evidence**
Test: `apps/ingestor/src/entity-resolver.test.ts::transient timeout is retried and cycle completes; transientRetryCount is incremented`
Output excerpt:
```
ok 5 - transient timeout is retried and cycle completes; transientRetryCount is incremented
  ---
  duration_ms: 227.2
  type: 'test'
```
Key assertions verified:
- `participantUpserts.sort()` === `['p1','p2','p3']` (all players resolved)
- `callCountByPlayer.get('p1')` === 2 (retried once)
- `timings.transientRetryCount` === 2 (two recovered retries)
- `timings.errors` === 0 (recovered retries NOT counted as errors)

### E6 entity-resolver budget exhausted

**Test evidence**
Test: `apps/ingestor/src/entity-resolver.test.ts::budget exhausted on permanent timeout: cycle fails closed`
Output excerpt:
```
ok 6 - budget exhausted on permanent timeout: cycle fails closed
  ---
  duration_ms: 306.6
  type: 'test'
```
Assertion: `callCountByPlayer.get('p1')` === 3 (all 3 attempts fired before rejection).

### E7 entity-resolver non-retryable

**Test evidence**
Test: `apps/ingestor/src/entity-resolver.test.ts::non-retryable error is not retried and propagates immediately`
Output excerpt:
```
ok 7 - non-retryable error is not retried and propagates immediately
  ---
  duration_ms: 1.4
  type: 'test'
```
Error: `permission denied for table participants` — not a timeout, so `callCount === 1`.

### E8 pnpm verify

**Repo-truth evidence**
Command: `pnpm verify` in worktree `claude__utv2-1373-mlb-participant-upsert-timeout`
Exit code: 0
All sub-checks passed: ops:sync-check, ops:system-alignment-check, ops:automation-coverage-check, env:check, lint, type-check, build, test (all suites, 0 failures)

### E9 pnpm test:db

**Test evidence**
Command: `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)
Output (tail):
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105317.373396
```
All 7 assertions passed: DB connectivity, picks write path, participants no-duplicate constraint, settlement correction chain.

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| withRetry retries on transient statement timeout and succeeds | 1, 5 |
| Exhausted retry budget rethrows (fail-closed) | 2, 6 |
| Non-retryable errors propagate immediately without retrying | 3, 7 |
| attempts=1 disables retry (matches today behavior) | 4 |
| Successful retries increment transientRetryCount, not errors | 5 |
| pnpm verify green | 8 |
| pnpm test:db pass (live Supabase) | 9 |

## Stop Conditions Encountered

None.

## Sign-off

**Verifier:** claude/utv2-1373-mlb-participant-upsert-timeout — 2026-06-30
**PM acceptance:** pending

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
