# UTV2-869 Runtime Version Surface

Generated: 2026-05-09

## New runtime metadata contract

The API/scorer runtime now reads these explicit fields:

- `UNIT_TALK_GIT_SHA`
- `UNIT_TALK_BUILD_TIMESTAMP`
- `UNIT_TALK_DEPLOYMENT_ID`
- `UNIT_TALK_SCORER_RUNTIME_VERSION`

Default scorer contract version in repo:

- `candidate-scoring-ownership-v1`

## New operator-visible surfaces

### 1. `GET /api/health/runtime`

Auth: operator role required.

Returns:

- Git SHA
- short Git SHA
- build timestamp
- deployment identifier
- metadata completeness flag
- missing metadata field list
- scorer runtime version
- scorer system run type
- scorer cadence
- scorer execution path
- runtime instance hostname when available

### 2. `/health`

Now includes a concise version summary:

- `gitShaShort`
- `deploymentIdentifier`
- `scorerRuntimeVersion`
- `metadataComplete`

### 3. API startup logs

`apps/api/src/index.ts` now logs runtime version fields at process startup so operator logs can be matched to a deploy event.

### 4. Scorer logs

`apps/api/src/candidate-scoring-service.ts` now logs runtime version data on:

- `run.started`
- `run.completed`
- `no_unscored_candidates`

### 5. `system_runs`

`candidate.scoring` rows now preserve:

- `details.runtimeVersion.gitSha`
- `details.runtimeVersion.buildTimestamp`
- `details.runtimeVersion.deploymentIdentifier`
- `details.runtimeVersion.scorerRuntimeVersion`

That gives the post-deploy proof path a durable DB join:

`pick_candidates.scoring_run_id` -> `system_runs.id` -> `system_runs.details.runtimeVersion`

## Container build surface

The API Docker target now accepts:

- `ARG UNIT_TALK_GIT_SHA`
- `ARG UNIT_TALK_BUILD_TIMESTAMP`
- `ARG UNIT_TALK_SCORER_RUNTIME_VERSION`

and stamps the image with:

- `ENV UNIT_TALK_GIT_SHA`
- `ENV UNIT_TALK_BUILD_TIMESTAMP`
- `ENV UNIT_TALK_SCORER_RUNTIME_VERSION`
- OCI labels for revision and created time

## Remaining limits

This issue adds the runtime fingerprint surface. It does not itself prove production has been redeployed to a converged build.

That proof requires:

1. deploy a new API runtime with explicit metadata fields set
2. read `GET /api/health/runtime`
3. confirm new `candidate.scoring` `system_runs` rows carry the same fingerprint
4. observe one fresh scored candidate row with non-null ownership persistence
