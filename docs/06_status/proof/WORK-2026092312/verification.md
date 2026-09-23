# PROOF: WORK-2026092312

MERGE_SHA: 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-23T21:48:56.000Z
Issue: WORK-2026092312
Tier: T3
Lane type: governance
Branch: claude/work-2026092312-reactivation-gate-drop-paths
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1640
Head SHA: 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943
Execution SHA: 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943
Diff base: 7159bcdeb2141b4b620f3335122df63fa0d39721
result: pass

## ASSERTIONS:

Documentation-only lane. Every box is a claim about the content of the diff, checkable by reading
the diff or re-running the measurement it cites.

- [x] A8 and A9 are added to section A of `docs/05_operations/SGO_REACTIVATION_GATE.md`; A1–A7 are unchanged.
- [x] pg_cron job 5 is described from `cron.job` / `cron.job_run_details` (read-only): active,
      `0 3 * * *`, 136 runs 2026-05-10 → 2026-09-23, every one failed.
- [x] The ingestor retention citations resolve on this branch: `ingestor-runner.ts:494`,
      `index.ts:64` (MAX_CYCLES 0 → infinite loop), `index.ts:130` (`retentionConnection`), and
      `deploy.yml` sets `UNIT_TALK_INGESTOR_MAX_CYCLES=0`.
- [x] The A9 citation `db-health-tripwire.ts:177` is `pg_total_relation_size(relid)`, and the
      2026-09-23 tripwire run 35918291130 printed `provider_offer_history | 0 MB | 300 MB | env | PASS`.
- [x] The A6 measurement comes from `pg_stat_user_tables`: `autovacuum_count = 0` for every table,
      and `system_runs` shows 12,142 dead tuples against 12,224 live.
- [x] The conveyor citations resolve: `cli.ts:149` returns 1 without object-store config, and
      the workflow header's line 14 says "exits cleanly".
- [x] The document still authorizes nothing. No workflow, schedule, script, schema or data is changed.

## EVIDENCE:

```
$ git diff --name-only 7159bcdeb2141b4b620f3335122df63fa0d39721 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943 | grep -cv -E '^(docs/|\.ops/)'
0
$ pnpm verify:quick
exit 0 (sync-check, env, lint, type-check)
```

## Verification

- `pnpm verify:quick` exit 0 on 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943
- `ops:preflight WORK-2026092312` VERDICT PASS (38 checks)
- CI `verify` on the PR head

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1640
Approved PR head: pending merge
Execution SHA: 7501e5a17fee7ec2f9ac70fd4cb22a4ca05ab943
