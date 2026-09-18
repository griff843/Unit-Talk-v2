-- Rollback for 20260918020000_utv2_1814_certification_propagation_rpc.sql
--
-- Drops exactly what the forward migration created: one function. The forward migration
-- creates no table, type, index or policy, so nothing else is owned by it. The ACLs go
-- with the function.
--
-- ## What reverting means operationally
--
-- Removing this function does NOT restore a prior working state -- it restores the
-- OUTAGE. `invalidateExpiredCertificationProofs` runs during worker start-up and
-- `insertPropagationBatch` throws when the RPC is absent, which aborts `worker.autorun`.
-- The worker container keeps reporting `running=true` with `RestartCount=0` while never
-- polling the distribution outbox, so no delivery is attempted and nothing surfaces as
-- unhealthy. That is the failure this migration exists to end, and it is not changed
-- here.
--
-- This rollback is therefore only correct as part of reverting the whole change -- a
-- scratch round-trip drill, or backing out an application whose code is also being
-- backed out. It must never be run against an environment whose worker is expected to
-- deliver.
--
-- No data-loss override is claimed: the function owns no rows. Certification records and
-- transition events already written by it are append-only ledger rows that survive this
-- drop untouched, and their tables' immutability triggers are independent of it.

-- ─────────────────────────────────────────────────────────────────────────────
-- OWNERSHIP PRECONDITION — must remain the first executable statement.
--
-- A bare DROP ... IF EXISTS drops whatever happens to carry the name, which is not the
-- same thing as undoing this migration. The up-migration stamps the function with a
-- UTV2-1814 comment, so ownership is recorded in the catalog rather than assumed, and
-- its own fail-closed precondition refuses to replace an unmarked object. Together the
-- two guards mean this script can only remove the object this migration created.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- to_regprocedure returns NULL rather than raising when the function is absent, so a
  -- missing object reports as a refusal instead of an undefined-object error that would
  -- read like a broken script. It also pins the exact callable identity; comparing
  -- pg_get_function_identity_arguments to a type-only string does NOT work, because that
  -- output carries parameter names.
  v_function oid := to_regprocedure('public.insert_certification_propagation_batch(jsonb, jsonb)');
  v_function_marker text := obj_description(v_function, 'pg_proc');
BEGIN
  IF v_function_marker IS NULL OR v_function_marker NOT LIKE 'UTV2-1814:%' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'public.insert_certification_propagation_batch(jsonb, jsonb) is absent or does not carry the UTV2-1814 ownership marker; this rollback refuses to drop an object it did not create.',
      HINT    = 'Inspect the function and its comment. Roll it back by whatever created it.';
  END IF;
END;
$$;

-- Unqualified DROP, deliberately. The guard above has already established that the
-- function exists and is this migration's, so IF EXISTS here would only serve to hide a
-- disagreement between the guard and the DROP.
DROP FUNCTION public.insert_certification_propagation_batch(jsonb, jsonb);
