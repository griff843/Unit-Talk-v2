# PROOF: UTV2-1605 — grading outcome and input-freshness observability

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1621
Execution/source SHA: `465fe4e0a4c948f8e3f5e86440cda60d3bf6918a`

## Assertions

ASSERTIONS:

- [x] Every created `grading.run` carries a machine-readable `details.outcome_class` while preserving the existing `system_runs.status` values.
- [x] The five outcome classes explicitly ratified by PM on 2026-09-19 are distinguishable **at the class, not only in the histogram**. A run
  with graded work reports `succeeded_with_work`; a pass that **examined rows and graded none**
  reports `no_op_nothing_gradeable`; a pass that **examined nothing at all** reports
  `no_op_no_input`; stale result-dependent skips report `degraded_stale_input` and DB status
  `failed`; execution errors report `failed`.
- [x] `no_op_no_input` is a positive assertion that there was no input, and is reachable only when
  `rowsScanned == 0 && skipped == 0`. The readiness probe carries the inverse guard: a run labelled
  `no_op_no_input` that records scanned or skipped rows is a **failure**, not a pass. A mutation
  control in `grading-cron.test.ts` proves the probe refuses a mislabelled 15,000-row run.
- [x] Run details record rows scanned, gradeable rows, graded/skipped/error counts, skip histogram, latest provider `game_results.sourced_at`, and the six-hour freshness threshold.
- [x] Readiness evaluates grading outcome/input health independently of cron recency. Alerts open with actionable context, deduplicate while unhealthy, and clear after fresh successful work.
- [x] Production settlement proof requires all three predicates: `source = 'grading'`, `settled_by = 'grading-service'`, and `evidence_ref LIKE 'game-result:%'`.

## Verification

EVIDENCE:

| Command | Result |
|---|---|
| `pnpm verify:static` | PASS — exit 0; 6,808 tests, 6,808 pass, 0 fail, 0 skipped, zero `not ok` lines |
| `pnpm type-check` | PASS |
| `pnpm test` | PASS as the test stage inside `pnpm verify:static` |
| `pnpm exec tsx --test 'apps/api/src/grading-cron.test.ts' 'apps/api/src/grading-service.test.ts'` | PASS — 111/111 |
| `pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts` | PASS — 32/32 |
| `pnpm exec tsx --test apps/ingestor/src/ingestor.test.ts` | PASS — 93/93 |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS — 13 changed files, no rules matched |
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

## PM correction: five-value acceptance model

PM review: https://github.com/griff843/Unit-Talk-v2/pull/1621#issuecomment-5745491341
The follow-up instruction explicitly accepts the fifth state; this records that decision, not a new runtime design.

| outcome_class | Meaning | system_runs.status | Readiness |
| --- | --- | --- | --- |
| succeeded_with_work | At least one pick graded, no degrading input/error condition | succeeded | pass when counters/freshness are consistent |
| no_op_no_input | No rows examined and no skips | succeeded | pass for genuine no-input run |
| no_op_nothing_gradeable | Rows examined or skipped but none graded | succeeded | pass only with consistent counters and healthy relevant inputs |
| degraded_stale_input | Data-dependent skips and stale/missing inputs | failed | fail |
| failed | Execution/invariant error | failed | fail |

Unknown classes fail closed. The database status enum is unchanged. Generic DB smoke is not proof of the new freshness query. PM authorized the single-file staging proof addition through an external scope-override/v1 comment on reviewed HEAD 5c6714fd8d5e1aeebb003298075258594f20e6d6. The override must be renewed at the final HEAD. The added cases in t1-proof-utv2-1886-settlement-batch.test.ts independently reduce live source timestamps and exercise the real grading freshness read and persisted no-input run. An empty candidate restriction prevents settlement or delivery. These cases must pass in the approved staging live suite before this correction is review-ready.
