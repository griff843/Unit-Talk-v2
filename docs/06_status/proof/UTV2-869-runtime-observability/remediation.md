# UTV2-869 Runtime Convergence Remediation

Generated: 2026-05-09

## Current conclusion

Current repo code is not the runtime that wrote the May 9 scored rows.

Do not reopen UTV2-863 until a fresh post-deploy scored row exists with:

- non-null `model_registry_id`
- non-null `scoring_run_id`
- non-null `ownership_timestamp`

## Guaranteed convergence steps

1. Build immutable API images with explicit metadata.

Required build args:

- `UNIT_TALK_GIT_SHA=<full commit sha>`
- `UNIT_TALK_BUILD_TIMESTAMP=<ISO-8601 UTC>`
- `UNIT_TALK_SCORER_RUNTIME_VERSION=candidate-scoring-ownership-v1`

2. Inject a deploy-specific runtime identifier.

Required env:

- `UNIT_TALK_DEPLOYMENT_ID=<release id>`

Do not reuse `latest` as the only deploy identifier.

3. Stop stale scorer processes before declaring success.

At minimum:

- replace the API container that owns the scorer scheduler
- confirm any legacy ad hoc scorer process is stopped
- confirm no old host supervisor restarts the stale build

4. Prove the deployed runtime fingerprint live.

Operator check:

- call `GET /api/health/runtime`
- verify SHA, build timestamp, deployment ID, and scorer runtime version

5. Prove scorer persistence live.

After fresh candidate creation, verify:

- `system_runs` contains a new `candidate.scoring` row
- `system_runs.details.runtimeVersion` matches `/api/health/runtime`
- the newly scored `pick_candidates` row has all three ownership fields populated

## Fresh-row acceptance gate

A valid post-deploy proof row must satisfy all of these:

- created after the redeploy timestamp
- scored after the redeploy timestamp
- linked to a `candidate.scoring` `system_runs` row from the new deployment ID
- ownership trio all non-null

Historical rows do not count.

## Non-remediations

Do not use any of these as substitutes for runtime convergence:

- historical ownership backfill
- fake proof rows
- schema-only repair
- migration-only reconciliation
- inferring deploy identity from score values or timestamps alone
