# UTV2-869 Deployment Path Analysis

Generated: 2026-05-09

## Proven deployment shape

The production scorer path in the current repo lives inside the API container, not the worker:

`Dockerfile (api target)` -> `apps/api/src/index.ts` -> scheduler timer -> `runCandidateScoring()` -> `CandidateScoringService.run()` -> `pickCandidates.updateModelScoreBatch()`

Supporting deploy surfaces:

- `Dockerfile`
- `docker-compose.prod.yml`
- `apps/api/src/index.ts`
- `apps/api/src/candidate-scoring-service.ts`
- `packages/db/src/runtime-repositories.ts`

## Current ambiguity before this change

Before UTV2-869 runtime observability, the deploy path had three blind spots:

1. `docker-compose.prod.yml` referenced mutable image tags like `unit-talk/api:${API_IMAGE_TAG:-latest}`.
2. The runtime did not expose the executing Git SHA or build timestamp.
3. `candidate.scoring` `system_runs` rows did not preserve a runtime fingerprint.

That meant repo-side evidence could prove drift, but not identify the exact deployed build.

## What the repo can now expose

The API runtime now surfaces explicit scorer identity through:

- environment-backed build metadata
- startup log fields
- `GET /api/health/runtime` (operator auth)
- `/health` version summary
- `system_runs.details.runtimeVersion` for `candidate.scoring`

## Candidate execution paths

Current repo search shows one production scoring writer and several manual wrappers:

- Production writer: API scheduler in `apps/api/src/index.ts`
- Manual proof wrapper: `scripts/shadow-scoring-runner.ts`
- Manual proof wrapper: `scripts/utv2-470-scoring-proof.ts`
- Manual proof wrapper: `scripts/sgo-shadow-scoring-proof.ts`

Those wrappers all reuse the same service. No second current repo production scorer was found.

## Live runtime state observed on 2026-05-09

`pnpm runtime:health --json` at `2026-05-09T22:02:40.236Z` reported:

- Worker supervision: failed, last heartbeat 20.5h old
- Provider freshness: failed, latest offer 249.0h old
- Scheduler safety: failed, last autonomous pick 30.9h old
- Discord delivery: failed, last receipt 30.1h old

That proves the live runtime estate is stale or partially stalled. It does not prove the currently checked-out repo build is what production is executing.

## May 9 writer determination

From the earlier live drift proof in `docs/06_status/proof/UTV2-869-runtime-drift/`:

- May 9 scored `pick_candidates` rows had `model_score` populated
- `model_registry_id`, `scoring_run_id`, and `ownership_timestamp` were all `NULL`
- live `system_runs` contained no `candidate.scoring` rows for the write window

Current repo code cannot produce that state because:

- `apps/api/src/candidate-scoring-service.ts` now writes the ownership trio with each score update
- `packages/db/src/runtime-repositories.ts` hard-fails score writes when ownership fields are missing

Conclusion: the May 9 rows were written by a stale pre-UTV2-854 scorer runtime or an alternate long-lived process built from that code line, not by the current repo runtime.
