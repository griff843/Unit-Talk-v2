# UTV2-853 Ownership Persistence Planning Proof

Generated: 2026-05-07T20:55:20.0105315Z

This folder is a read-only investigation and migration-planning pass. No migration was applied, no runtime write behavior was changed, no production data was mutated, and no historical ownership was fabricated.

0% model attribution at baseline. All scanner picks are heuristic until migration + code change are approved and deployed.

## Files

- `ownership-persistence-plan.json` - machine-readable investigation summary and insertion point.
- `model-score-write-path.csv` - exact model_score write path and transaction/batching notes.
- `schema-gaps.json` - current schema gaps from standards, migrations, and prior proof.
- `migration-plan.sql` - exact SQL draft, wrapped in `BEGIN`/`ROLLBACK` as a non-executable planning artifact.
- `runtime-change-plan.md` - implementation lane file/function plan.
- `enforcement-plan.json` - future hard-fail, quarantine, and warn-only behavior.
- `evidence.json` - command/evidence index for this pass.

## Exact Write Path

Candidate scoring is scheduled from `apps/api/src/index.ts` lines 132-150. The scoring service is `CandidateScoringService.run()` in `apps/api/src/candidate-scoring-service.ts` lines 103-307. The score update is queued at lines 259-264.

The repository contract is `IPickCandidateRepository.updateModelScoreBatch()` in `packages/db/src/repositories.ts` lines 1055-1060. The database implementation is `DatabasePickCandidateRepository.updateModelScoreBatch()` in `packages/db/src/runtime-repositories.ts` lines 7841-7857.

The DB table is `pick_candidates`. The score write is an `UPDATE`, not an insert or upsert. Candidate creation/materialization uses `upsertCandidates()` separately. Scoring is service-batched, but the database repository loops over each candidate and sends one Supabase update per row. There is no explicit application-level multi-row transaction.

## Registry Lookup

Current lookup is `CandidateScoringService.resolveChampion()` -> `DatabaseModelRegistryRepository.findChampion()`. It matches `sport`, `market_family`, and `status = 'champion'`.

Current `model_registry` schema has `id`, `model_name`, `version`, `sport`, `market_family`, `status`, `champion_since`, timestamps, and `metadata`. It does not have `registry_entity_type`, `source_type_compatibility`, `active_state`, owner, training window, validation, calibration, or promotion approval columns.

## Migration Readiness

The implementation migration lane is ready for operator review, not live application. Required operator decisions:

- Approve the `pick_candidates` ownership columns and indexes.
- Approve the `model_registry` metadata columns.
- Decide whether `active_state` supplements or replaces current `status`.
- Decide whether `scoring_run_id` should strictly reference `system_runs(id)` immediately or remain nullable until candidate scoring creates/receives a run id.

No historical backfill is permitted.
