# PROOF: WORK-2026092309

MERGE_SHA: 98b4b93872c4eff555c35c9ea6dd328a040c75a1

Generated at: 2026-09-23T20:15:09.000Z
Issue: WORK-2026092309
Tier: T2
Lane type: governance
Branch: claude/work-2026092309-readiness-reader-pages
Head SHA: 98b4b93872c4eff555c35c9ea6dd328a040c75a1
result: pass

## ASSERTIONS:

- [x] `wrapReadOnlyClient().selectRows` (`scripts/ops/readiness-refresh.ts`) no longer issues a
      single `.limit(limit)` read. PostgREST caps every response at its `max-rows` (1000),
      whatever `.limit()` asks for. The blocking `dead_letter_count` dimension therefore read
      1000 of 1954 production dead letters. The ledger of 2026-09-23T16:30Z records
      `UNREADABLE ... read 1000 of 1954 dead_letter rows (limit 20000)`.
- [x] It now reads `id`-ordered `range` pages of at most `SELECT_PAGE_SIZE` (1000) until an
      empty page or `limit`. Stopping only on an empty page keeps it complete under any smaller
      server cap.
- [x] A failed page rejects the whole read, rather than returning the pages read before it.
- [x] Both probes' completeness guards are unchanged. A population above the limit, or a short
      read, is still `unknown` and never a pass.
- [x] The ledger's read-only guarantee is unchanged. The generator source test still finds no
      mutation path.
- [x] Scope: `readiness-refresh.ts` and its test. No production write, migration, deploy,
      delivery or containment change.

## EVIDENCE:

### 1. Mutation drill: `selectRows`

Each mutation was applied alone, the suite run, and the file restored from a copy before the
next. The restored file is byte-identical to the committed one (`cmp`).

```
== M1 single .limit() read            (the pre-lane reader)
not ok 31 - selectRows reads a population larger than the PostgREST row cap in full
not ok 32 - selectRows still reads everything when the server cap is smaller than a page
not ok 33 - selectRows honours its limit exactly
not ok 34 - a failed page rejects the whole read rather than returning the pages before it
not ok 35 - the dead-letter dimension issues a verdict over a queue larger than the row cap
# pass 32
# fail 5
== M2 stop on a short page            (instead of an empty one)
not ok 31 - selectRows reads a population larger than the PostgREST row cap in full
not ok 32 - selectRows still reads everything when the server cap is smaller than a page
# pass 35
# fail 2
== M3 no .order('id')                 (unordered pages)
not ok 31 - selectRows reads a population larger than the PostgREST row cap in full
not ok 32 - selectRows still reads everything when the server cap is smaller than a page
# pass 35
# fail 2
== restored
# pass 37
# fail 0
```

The first run of M3 passed, because the fake served rows in insertion order whether or not the
read was ordered. Postgres promises no row order without `ORDER BY`. The fake now serves an
unordered read rotated per request, so unordered paging reads some rows twice and misses
others. The `Set` size assertions catch that.

### 2. Tests

```
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
# tests 37
# pass 37
# fail 0

$ pnpm test
tests 6838, pass 6838, fail 0 (zero 'not ok' TAP lines across the workspace)
```

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none)
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm exec eslint` on the 2 changed files: exit 0
- [x] `pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts`: 37 pass, 0 fail
- [x] `pnpm test`: 6838 pass, 0 fail
- [x] `ops:preflight` (PB2 runs the full `pnpm test`): PASS, 38 checks
- [x] Mutation drill: each of the 3 mutations turns a named test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2 and changes only how the ledger generator reads. No live-DB proof is claimed.
The next scheduled `readiness-refresh.yml` run against production is where the change becomes
observable. `dead_letter_count` should then carry a measured verdict over all 1954 rows,
instead of `UNREADABLE ... read 1000 of 1954`. This lane asserts no verdict in advance: the
bucketing may still find true failures, and a `fail` there would be a correct measurement.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1637
Execution SHA: 98b4b93872c4eff555c35c9ea6dd328a040c75a1
