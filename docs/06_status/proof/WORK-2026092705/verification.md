# PROOF: WORK-2026092705

MERGE_SHA: pending merge

Issue: WORK-2026092705
Tier: T2
Lane type: governance
Branch: claude/work-2026092705-runtime-health-queue
result: pass

## ASSERTIONS:

- [x] Queue Movement reads every non-sent `distribution_outbox` row with `readAllPages`, the
      id-ordered paged reader from `scripts/ops/pipeline-health-classification.ts`, and compares the
      read against an exact `count` of non-sent rows. A shorter read, or an unreadable count, is
      `UNKNOWN`, never `HEALTHY`. Tests: "a read shorter than the exact non-sent count is UNKNOWN,
      never healthy", "a partial read is UNKNOWN even when the sample shows a true failure", "an
      unreadable exact count is UNKNOWN".
- [x] `sent` rows are counted with an exact head count and never fetched.
- [x] Dead letters are bucketed with `partitionDeadLetters`, the canonical rule. Row-for-row parity
      with the readiness gate's `bucketDeadLetterRows` is asserted. Test: "dead-letter counts match
      the readiness gate on the same rows".
- [x] True failures are `FAILED`. Governance holds and unattempted-unclassified rows are `DEGRADED`,
      with counts named. Tests 5–7 and 10.
- [x] No database write, containment change, or change to a delivery path. The only verbs are
      `select` and `count`.

## EVIDENCE:

### 1. Live population, read-only (production `zfzdnfwdarxucxtaojxm`, 2026-09-27T17:40Z)

```
distribution_outbox by status: sent 3760, dead_letter 1954, processing 32, pending 4   (5750 rows)
old code: one unfiltered, unordered select, so PostgREST max-rows returned at most 1000 of 5750
canonical buckets (classifyDeadLetter x attempt_count): governance_hold 1950, unattempted_unclassified 4, true_failure 0
old local rule over ALL rows: 41 "true dead_letter" + 4 null-reason rows it matched in neither bucket
processing rows claimed more than 5 minutes ago: 32
```

The canonical buckets equal the readiness ledger's `dead_letter_count` and `pnpm pipeline:health`
on the same day (1950 / 4 / 0). Under this change Queue Movement reports `DEGRADED`, naming the
1950 governance holds, the 4 unattempted rows and the 32 stuck claims, with no true failure. That
shape is test 10.

### 2. Mutation drills

```
M1: partial-read check removed (nonSentCount !== rows.length)
not ok 2 - a read shorter than the exact non-sent count is UNKNOWN, never healthy
not ok 3 - a partial read is UNKNOWN even when the sample shows a true failure
# fail 2
M2: holds / unattempted -> DEGRADED line removed
not ok 6 - governance holds are DEGRADED and named, whatever their attempt count
not ok 7 - an unattempted, unclassified dead letter is DEGRADED, not FAILED
# fail 2
```

The file was restored from a copy after each drill, and the suite passes 10/10.

## Verification

```
pnpm exec tsx --test scripts/ops/runtime-health-queue.test.ts        # pass 10, fail 0
pnpm exec eslint scripts/runtime-health.ts scripts/ops/runtime-health-queue*.ts   # exit 0
pnpm type-check                                                     # exit 0 (lane worktree, and preflight PB1)
pnpm test                                                           # pass (preflight PB2, full suite)
pnpm verify                                                         # runs as the required `verify` CI job on this PR
pnpm exec tsx scripts/ci/r-level-check.ts --base ff04ac003 --head c679ab1ff   # Verdict: PASS, no R-level artifacts required
```

A direct run of `pnpm runtime:health` from the workstation cannot reach production, because
`local.env` carries containment placeholders. Evidence 1 is a governed read-only SQL read of the
same population.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1672
