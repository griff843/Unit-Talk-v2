# PROOF: UTV2-1605 — grading outcome and input-freshness observability

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1621
Execution/source SHA: `5f3d818a1aeea4e1c99cc6483ca5655d0b266dd3`

## Assertions

ASSERTIONS:

- Every created `grading.run` carries a machine-readable `details.outcome_class` while preserving the existing `system_runs.status` values.
- A run with graded work reports `succeeded_with_work`; a fresh empty/legitimate skips-only pass reports `no_op_no_input`; stale result-dependent skips report `degraded_stale_input` and DB status `failed`; execution errors report `failed`.
- Run details record rows scanned, gradeable rows, graded/skipped/error counts, skip histogram, latest provider `game_results.sourced_at`, and the six-hour freshness threshold.
- Readiness evaluates grading outcome/input health independently of cron recency. Alerts open with actionable context, deduplicate while unhealthy, and clear after fresh successful work.
- Production settlement proof requires all three predicates: `source = 'grading'`, `settled_by = 'grading-service'`, and `evidence_ref LIKE 'game-result:%'`.

## Verification

EVIDENCE:

| Command | Result |
|---|---|
| `pnpm verify:static` | PASS — 6,806 tests, 6,806 pass, 0 fail, 0 skipped |
| `pnpm type-check` | PASS |
| `pnpm test` | PASS as the test stage inside `pnpm verify:static` |
| `pnpm exec tsx --test 'apps/api/src/grading-cron.test.ts' 'apps/api/src/grading-service.test.ts'` | PASS — 109/109 |
| `pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts` | PASS — 32/32 |
| `pnpm exec tsx --test apps/ingestor/src/ingestor.test.ts` | PASS — 93/93 |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS — 14 changed files, no rules matched |
| `pnpm test:db` | BLOCKED/DEFERRED before writes by staging identity guard |

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The actual local guard receipt reported `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` and exited before `database-smoke.test.ts` executed. No database row was written, updated, or deleted. The PR's staging-only writable DB job is the authority for the required T1 database proof.

## Production proof query

`source = 'grading'` is insufficient because test actors can use that source. Production settlement evidence must use:

```sql
SELECT *
FROM settlement_records
WHERE source = 'grading'
  AND settled_by = 'grading-service'
  AND evidence_ref LIKE 'game-result:%';
```

The focused unit suite includes a negative control proving that source alone admits test rows while the authoritative conjunction excludes them.

## Deployment warning

Dashboards may turn RED on the first correct deployment if the result feed is already stale and grading has data-dependent skips. That is exposure of an existing ingestion incident, not a regression caused by this observability change. A genuinely fresh empty slate remains `no_op_no_input` and does not open an incident.

## Boundaries

- No migration and no widening of the live `system_runs.status` constraint.
- No settlement outcome or lifecycle rule changed.
- No production write was performed during local proof.
- Exact-head independent Opus 5 review and Griff approval remain external merge gates.
