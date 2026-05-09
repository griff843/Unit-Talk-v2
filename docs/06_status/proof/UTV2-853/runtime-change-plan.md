# UTV2-853 Runtime Change Plan

This is a planning artifact only. No migration was applied and no runtime write behavior was changed.

## Exact scoring write path

`apps/api/src/index.ts` schedules candidate scoring at lines 132-150. The runtime passes `pickCandidates`, `marketUniverse`, `marketFamilyTrust`, `modelRegistry`, and `experimentLedger` into `runCandidateScoring()`.

`apps/api/src/candidate-scoring-service.ts` owns scoring in `CandidateScoringService.run()` at lines 103-307. It loads qualified/rejected candidates, filters to `model_score === null`, loads market universe rows, resolves a champion model, computes `model_score`, `model_tier`, and `model_confidence`, and pushes a `ModelScoreUpdate` at lines 259-264.

`packages/db/src/runtime-repositories.ts` persists the score in `DatabasePickCandidateRepository.updateModelScoreBatch()` at lines 7841-7857. The method loops over updates and performs one Supabase `UPDATE pick_candidates SET model_score, model_tier, model_confidence, updated_at WHERE id = ...` per candidate.

## Required code changes

1. Extend `ModelScoreUpdate` in `packages/db/src/repositories.ts` with:
   - `model_registry_id: string`
   - `scoring_run_id: string | null`
   - `ownership_timestamp: string`

2. Update `InMemoryPickCandidateRepository.updateModelScoreBatch()` and `DatabasePickCandidateRepository.updateModelScoreBatch()` in `packages/db/src/runtime-repositories.ts` to persist ownership fields in the same mutation as the score fields.

3. Update `CandidateScoringService.run()` in `apps/api/src/candidate-scoring-service.ts` at the `updates.push()` insertion point to pass:
   - `model_registry_id: champion.id`
   - `scoring_run_id: current system_runs.id when runtime support exists`
   - `ownership_timestamp: transaction/scoring timestamp`

4. Strengthen registry lookup in `CandidateScoringService.resolveChampion()` and `DatabaseModelRegistryRepository.findChampion()`:
   - Match sport and derived market family.
   - Require `registry_entity_type = 'champion_model'` when the column exists.
   - Require source compatibility for scanner/board ownership when the column exists.
   - Reject disabled/retired entries once active lifecycle columns exist.
   - Keep pre-migration warnings for missing metadata columns rather than pretending ownership exists.

5. Add repository tests and service tests:
   - Scoring writes fail or skip when no active registry owner exists.
   - Score update payload includes ownership fields.
   - Disabled/retired registry rows cannot score new candidates.
   - Historical rows with null ownership remain UNKNOWN and are not backfilled.
   - Post-enforcement candidates with null ownership are quarantined from model-edge analytics.

## Atomicity requirement

The current database implementation is not a true batch transaction. It loops and sends one update per row. The implementation lane should either:

1. Keep per-row updates but include `model_registry_id`, `scoring_run_id`, and `ownership_timestamp` in the exact same row update payload as `model_score`, or
2. Move score persistence into a repository RPC/transaction that updates all scoring fields atomically per batch.

The minimum acceptable contract is that no committed row can receive a new `model_score` without the matching `model_registry_id` in the same database mutation.

## Unknown and quarantine behavior

Historical candidates and picks with null ownership remain permanently UNKNOWN. Implementation must not infer ownership from sport, market family, timestamp, model score, tier, or confidence.

After the enforcement boundary, any candidate or pick that should have model ownership but lacks `model_registry_id` must be classified as UNKNOWN/quarantined for analytics. Operational processing can continue only if the future enforcement standard permits it; model-edge and syndicate samples must exclude it.

## Files expected in implementation lane

- `apps/api/src/candidate-scoring-service.ts`
- `apps/api/src/candidate-scoring-service.test.ts`
- `packages/db/src/repositories.ts`
- `packages/db/src/runtime-repositories.ts`
- `packages/db/src/types.ts`
- `packages/db/src/model-registry.test.ts`
- A migration under `supabase/migrations/` after operator approval
- DB smoke/contract coverage for ownership columns and FK behavior
