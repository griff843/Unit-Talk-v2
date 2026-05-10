# UTV2-869 Runtime Path Analysis

Generated: 2026-05-09

## Question
Determine exactly which runtime path wrote the May 9, 2026 scored `pick_candidates` rows and why ownership persistence was bypassed.

## Executive finding
The May 9 live writes are consistent with the pre-UTV2-854 scoring path:

`CandidateScoringService.run()` -> `IPickCandidateRepository.updateModelScoreBatch()` -> `DatabasePickCandidateRepository.updateModelScoreBatch()`

but from a build that predates commit `38392b5a` and therefore predates the ownership-aware `ModelScoreUpdate` contract.

The current repo code on `main` cannot produce the observed rows.

## Why the current repo cannot be the writer
Current `main` requires ownership fields in two independent places:

1. `apps/api/src/candidate-scoring-service.ts`
   The service now pushes `model_registry_id`, `scoring_run_id`, and `ownership_timestamp` with every score update.

2. `packages/db/src/runtime-repositories.ts`
   `assertValidModelScoreUpdate()` throws before any DB write if any ownership field is missing.

That means current `main` has only two possible outcomes for a scored row:

- score + ownership trio all persisted
- no score write at all because the update throws first

Live production shows a third state on 2026-05-09:

- `model_score`, `model_tier`, `model_confidence` updated
- `model_registry_id`, `scoring_run_id`, `ownership_timestamp` all still `NULL`

That state is impossible under the current repo code.

## Why the observed rows match the pre-UTV2-854 scorer
Git history shows the ownership write contract was introduced at:

- `38392b5a` — `feat(api): UTV2-854 persist model ownership at candidate scoring`
- `30b88e46` — `feat(db): UTV2-854 persist model ownership artifacts and types`

Immediately before `38392b5a`, the scoring update contract contained only:

- `id`
- `model_score`
- `model_tier`
- `model_confidence`

That older contract matches the live rows exactly.

Additional behavioral match:

- live rows in the May 9 burst show `model_confidence = 0.7`
- current seeded champions in `model_registry.metadata.confidence` are also `0.7`
- the write burst updated old candidate rows in place rather than inserting new ones

This is exactly what the old candidate scoring loop would do.

## Live runtime evidence
### 1. Ownership schema is live, but ownership persistence is globally absent

Live counts from project `zfzdnfwdarxucxtaojxm`:

- `7051` scored candidates total
- `7051` scored candidates with `model_registry_id IS NULL`
- `7051` scored candidates with `scoring_run_id IS NULL`
- `7051` scored candidates with `ownership_timestamp IS NULL`

This is not a partial failure. It is 100% bypass.

### 2. CandidateScoringService instrumentation is absent in production

Live `system_runs` contains:

- many `worker.heartbeat` rows
- scheduled `governance.awaiting-approval-drift` rows
- `0` rows where `run_type = 'candidate.scoring'`

Current `main` would create `system_runs` records through `startScoringRun()` with:

- `runType: 'candidate.scoring'`
- `actor: 'system:candidate-scoring'`

Those rows do not exist.

### 3. The May 9 write burst has no corresponding candidate-scoring run trace

Observed write window:

- earliest sampled scored row update: `2026-05-09T01:34:28.005+00:00`
- latest sampled scored row update: `2026-05-09T01:34:30.847+00:00`

Observed `system_runs` in the same window:

- only `worker.heartbeat`

No `candidate.scoring` row exists in the same window or anywhere else in live `system_runs`.

## Exact path determination
### Proven path
The write path that best fits all evidence is:

1. a scorer process enumerated existing `pick_candidates`
2. it computed `model_score`, `model_tier`, and `model_confidence`
3. it updated those columns directly through the old `updateModelScoreBatch()` contract
4. it never attempted to set `model_registry_id`, `scoring_run_id`, or `ownership_timestamp`
5. it never created a `system_runs` row for `candidate.scoring`

That is the pre-UTV2-854 candidate scoring runtime path.

### What was ruled out
- `current main` CandidateScoringService: ruled out by missing ownership fields and missing `candidate.scoring` run rows
- DB rejection of ownership writes: ruled out because the writes never attempted those columns; no partial ownership rows exist
- overwrite-after-write: ruled out because there are zero ownership-populated scored rows to overwrite
- rollback-after-write: ruled out because there are zero `candidate.scoring` runs and zero surviving ownership-populated scored rows
- migration absence: ruled out because the ownership columns exist live and the migration was reported present

## Alternate path analysis
Repo search found no second current runtime path that writes `model_score` directly outside the candidate scoring service and repository implementation.

So the realistic explanations reduce to:

1. a stale deployed API/scoring build predating UTV2-854
2. an alternate long-lived process built from pre-UTV2-854 code

Both explanations are runtime drift. The repo-side evidence cannot distinguish between those two host-side variants because the deployment host does not expose a runtime build fingerprint.

## CandidateScoringService production activity
Current repo logic is not active in production as instrumented.

Evidence:

- `0` `candidate.scoring` `system_runs`
- May 9 scored rows violate the current repo's required write contract

## Can one legitimate ownership-persisted live row be produced?
Not safely from the current live candidate pool.

Reason:

- there are `552` `qualified` candidates with `model_score IS NULL`
- `0` of those are viable for current scoring
- all `552` map to `market_universe.is_stale = true`

The current scorer intentionally skips stale universe rows, so it has no legitimate candidate to score right now without first creating fresh runtime data.

Because the task explicitly forbids fake proof and historical backfill, no ownership proof row was manufactured.

## Build identification
### What is proven
- the live writer is from a build older than `38392b5a`
- the live writer is not the current repo head `17c396644036516e7bec797acefe678a313744e4`

### What is not proven
The exact host image SHA is not recoverable from the available evidence.

Why:

- GitHub shows zero executed runs for the repo's `Deploy` workflow
- GitHub shows zero deployment records
- the host-side `.unit-talk-release` file is referenced by workflow code but not readable from this lane
- no runtime build SHA is exposed in `system_runs`, DB tables, or the observed health surface

So the exact SHA remains unproven due to missing deployment observability, not lack of runtime drift evidence.
