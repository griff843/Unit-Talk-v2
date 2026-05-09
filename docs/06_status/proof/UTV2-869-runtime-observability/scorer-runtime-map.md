# UTV2-869 Scorer Runtime Map

Generated: 2026-05-09

## Authoritative production write path

The current repo has one authoritative production scorer write path:

`apps/api/src/index.ts`
-> `runCandidateScoring(...)`
-> `apps/api/src/candidate-scoring-service.ts`
-> `IPickCandidateRepository.updateModelScoreBatch(...)`
-> `packages/db/src/runtime-repositories.ts`

Behavioral properties:

- runs on a 5 minute scheduler inside the API process
- writes `model_score`, `model_tier`, `model_confidence`
- writes `model_registry_id`, `scoring_run_id`, `ownership_timestamp`
- creates `system_runs` rows with `run_type = 'candidate.scoring'`
- now persists `details.runtimeVersion`

## Non-production wrappers

Repo search found wrapper paths that can invoke the same scorer logic manually:

- `scripts/shadow-scoring-runner.ts`
- `scripts/utv2-470-scoring-proof.ts`
- `scripts/sgo-shadow-scoring-proof.ts`

These are not independent scoring implementations. They all route back through `runCandidateScoring(...)`.

## Multiple scorer paths?

Yes, in the narrow sense that multiple entrypoints can invoke scoring.

No, in the critical runtime sense that matters for production ownership persistence:

- there is only one current repo scoring implementation
- there is only one current repo DB write contract for model score updates
- no second current repo production writer that bypasses ownership persistence was found

## Why the May 9 runtime is still ambiguous

The May 9 live writer does not match the current repo contract. The realistic explanations reduce to:

1. a stale API container/image predating UTV2-854
2. a second long-lived host process built from pre-UTV2-854 code

The new version surface added in this issue is specifically meant to distinguish those cases after redeploy.

## Worker status

The worker is not the scorer path.

`pnpm runtime:health --json` still matters because it proves the broader runtime estate is stale:

- worker heartbeat stale by about 20.5 hours
- queue not fully dead, but no fresh worker liveness

That is evidence of runtime drift or stalled supervision, but not evidence that the worker wrote `pick_candidates.model_score`.
