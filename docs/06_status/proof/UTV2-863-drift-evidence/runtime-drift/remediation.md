# UTV2-869 Remediation

Generated: 2026-05-09

## Root cause
Production scoring is running pre-UTV2-854 code or a pre-UTV2-854 alternate scorer process.

That runtime still writes:

- `model_score`
- `model_tier`
- `model_confidence`

and does not write:

- `model_registry_id`
- `scoring_run_id`
- `ownership_timestamp`

The result is complete ownership persistence bypass across all live scored candidates.

## Required remediation
1. Stop or replace the stale scorer runtime.
   Target: whichever deployed process is still executing the pre-UTV2-854 scoring loop.

2. Deploy a build at or after `38392b5a` and `30b88e46`.
   Both API/service and DB contract changes must be present together.

3. Add a host-visible runtime build fingerprint.
   Minimum acceptable surfaces:
   - build SHA in `/health`
   - build SHA in startup logs
   - build SHA in `system_runs.details` for scheduler-owned runs
   - readable host `.unit-talk-release`

4. Verify the deployed scorer by creating one fresh live candidate and observing:
   - `candidate.scoring` row in `system_runs`
   - non-null `model_registry_id`
   - non-null `scoring_run_id`
   - non-null `ownership_timestamp`

5. Do not backfill historical rows as proof.
   Historical repair, if later approved, must be treated separately from runtime proof.

## Why UTV2-864 stays blocked
UTV2-864 requires proven live ownership persistence.

Current state:

- ownership write success for live scored rows: effectively `0%`
- ownership write failure/bypass for live scored rows: effectively `100%`
- no legitimate fresh proof row is currently available from the stale candidate pool

So UTV2-864 must remain blocked until a fresh post-deploy live row proves the new path.

## Exact next checks after deploy
1. Confirm the host release SHA from the deploy target.
2. Query `system_runs` for `run_type = 'candidate.scoring'`.
3. Trigger or wait for one fresh live candidate score.
4. Verify the scored row includes all three ownership fields.
5. Re-run the UTV2-869 proof queries and compare counts.

## Non-remediations
Do not do any of the following as a substitute for fixing runtime drift:

- backfill old ownership columns and call that runtime proof
- repair the migration ledger
- add fake proof artifacts without a live post-deploy row
- infer model ownership from score value, tier, or pick source
