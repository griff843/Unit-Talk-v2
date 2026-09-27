# PROOF: WORK-2026092703

MERGE_SHA: pending merge

Issue: WORK-2026092703
Tier: T2
Lane type: governance
Branch: claude/work-2026092703-pipeline-health-dead-letters
result: pass

## ASSERTIONS:

- [x] The non-sent outbox read pages in `id`-ordered pages of 1000 until an empty page, and is
      compared against an exact count. A mismatch is a critical "outbox read incomplete" and exits
      1. Tests: "a population larger than one response is read completely, once per row", "the
      fake is discriminating: unordered range pages lose rows…", "a page error is raised, never
      returned as a shorter population".
- [x] Dead letters are split by `classifyDeadLetter(last_error)` crossed with `attempt_count > 0`,
      the rule the readiness gate uses. Parity is asserted against `bucketDeadLetterRows` row for
      row. Test: "dead-letter buckets match the readiness gate row for row…".
- [x] A recognised disposition is a governance hold whatever its attempt count, and a non-numeric
      or missing attempt count counts as attempted (fail closed). Tests: "a recognised disposition
      is a governance hold even after delivery was attempted", "a non-numeric or missing attempt
      count is treated as attempted (fail closed)".
- [x] True failures stay critical. Governance holds and unattempted-unclassified rows are named
      warnings with counts, and only true failures reach `evaluateQueueHealth`'s `dead_letter`
      alert. `outbox_dead_letter_count` keeps its meaning (true failures), so the monitor
      workflow's trigger is unchanged.
- [x] No database write, containment change, or change to `packages/observability`, the worker,
      `outbox-triage.ts`, `readiness-refresh.ts` or any delivery path.

## EVIDENCE:

### 1. Live population, read-only (production `zfzdnfwdarxucxtaojxm`, 2026-09-27)

```
non-sent outbox: dead_letter 1954, pending 4, processing 32  (1990 rows)
old read (.limit(5000), updated_at desc, PostgREST max-rows 1000):
  dead_letter in page 964, dropped 990; pending 4/0; processing 32/0
```

### 2. Dead-letter buckets over all 1954 rows (SQL mirror of classifyDeadLetter x attempt_count)

```
governance_hold 1950   unattempted_unclassified 4   true_failure 0
old local rule, same 1954 rows: 45 "true failures"
```

This matches the readiness ledger's `dead_letter_count` on the same day exactly
(1950 / 4 / 0), which was computed by `bucketDeadLetterRows`.

### 3. Mutation drills

```
M1: .order('id') removed from readAllPages
not ok 21 - a population larger than one response is read completely, once per row
# fail 1
M2: non-numeric attempt_count defaults to "not attempted"
not ok 17 - dead-letter buckets match the readiness gate row for row, so the two can never disagree
not ok 19 - a non-numeric or missing attempt count is treated as attempted (fail closed)
# fail 2
```

The file was restored from a copy after each drill, and the suite passes 23/23.

## Verification

```
pnpm exec tsx --test scripts/ops/pipeline-health-classification.test.ts   # pass 23, fail 0
pnpm exec eslint scripts/pipeline-health.ts scripts/ops/pipeline-health-classification*.ts   # exit 0
pnpm type-check                                                           # exit 0 (lane worktree, and preflight PB1)
pnpm test                                                                 # pass (preflight PB2, full suite)
pnpm verify                                                               # runs as the required `verify` CI job on this PR
pnpm exec tsx scripts/ci/r-level-check.ts --base 0ef9da1d1 --head 993427f5b   # Verdict: PASS, no R-level artifacts required
```

A direct run of `scripts/pipeline-health.ts` from the workstation cannot reach production,
because `local.env` carries containment placeholders. Evidence 1–2 is a governed read-only SQL
read of the same population.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1669
