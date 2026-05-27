# Atomic Propagation RPC Proof

Issue: `UTV2-1177`

PRs linked to this lane:

- PR #885: certification gate evidence base
- PR #886: deterministic replay runtime proof
- PR #887: worker runtime wiring and atomic propagation RPC

RPC: `insert_certification_propagation_batch`

Commit: `9096be7188e014f7cdec7baf12436a25494d9fd8`

The RPC persists certification propagation batches by inserting rows into `certification_records` and `certification_transition_events` in a single PL/pgSQL function call.

Append-only behavior: PASS

- The migration contains INSERT statements only for certification propagation persistence.
- It does not update, delete, or mutate existing certification rows.

Transactional rollback guarantee: PASS

- The RPC runs server-side in PostgreSQL.
- If any record or transition event insert fails, PostgreSQL aborts the function call and rolls back the full batch.

Failure-path test: PASS

- `apps/worker/src/certification-runtime.test.ts` includes a simulated event insert failure.
- The test proves no partial propagation records or transition events remain committed after the failure.

Verification verdict: PASS

- `pnpm verify` PASS
- `pnpm test:db` PASS
- R-level check PASS
- Migration reversibility PASS
- Schema round-trip drill PASS
