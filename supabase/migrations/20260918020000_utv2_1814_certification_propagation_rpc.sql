-- UTV2-1814: governed migration for public.insert_certification_propagation_batch.
--
-- ## Why this exists
--
-- `DatabaseCertificationRepository.insertPropagationBatch`
-- (apps/worker/src/certification-runtime.ts) calls
--
--     client.rpc('insert_certification_propagation_batch', { p_records, p_events })
--
-- and throws when the call returns an error. `invalidateExpiredCertificationProofs`
-- runs that path during worker start-up, so an absent function does not degrade the
-- worker -- it aborts `worker.autorun` outright. The worker container then stays
-- "running" with a healthy-looking process while never polling the outbox at all.
--
-- The function was written once, as
-- `20260527001_utv2_1177_atomic_certification_propagation_batch.sql`, but was never
-- applied to any live database. When UTV2-1274 rebaselined the migration ledger from a
-- snapshot *of live* (`00000000000000_baseline_live_schema.sql`), the object was not
-- there to capture. `supabase/migrations_archive/README.md` states archived migrations
-- are "already represented in" the baseline; for this object that premise was false,
-- and the function was lost from the repo's replay root and from both databases at once.
-- UTV2-1811 surfaced it as a pre-existing instance of its defect class and carried it as
-- a documented allowlist entry pointing at UTV2-1814.
--
-- This migration supplies the missing contract and nothing else. It does not change the
-- caller, relax the worker's fail-closed behaviour, or add a fallback: a database that
-- lacks this function still aborts worker autorun exactly as it does today.
--
-- ## Semantics
--
-- Body is carried forward faithfully from the UTV2-1177 definition, whose behaviour is
-- proven in docs/06_status/proof/UTV2-1177/. Both inserts are append-only and execute
-- inside the function's single transaction, so any row failing rolls the whole batch
-- back -- which is the atomicity the caller depends on.
--
-- Two deliberate differences from the archived text, neither semantic:
--
--   1. `search_path` is pinned to `pg_catalog, public` rather than `public`. Every
--      reference in the body is already schema-qualified, so resolution is unchanged;
--      pinning pg_catalog first is the standard hardening for a SECURITY DEFINER
--      function and matches UTV2-1811.
--   2. Explicit ACLs are set below. The archived migration set none, so the function
--      would have been created EXECUTE-to-PUBLIC -- i.e. callable by `anon` through
--      PostgREST. A SECURITY DEFINER writer into the certification ledger must never be
--      browser-reachable.
--
-- SECURITY DEFINER is retained from the proven UTV2-1177 definition. The certification
-- tables carry immutability triggers that forbid UPDATE and DELETE, so the elevated
-- right this function confers is append-only by construction.

-- ─────────────────────────────────────────────────────────────────────────────
-- FAIL-CLOSED PRECONDITION — must remain the first executable statement.
--
-- CREATE OR REPLACE would silently overwrite a same-named function created out of band,
-- destroying its definition while reporting success. This refuses instead. The matching
-- down script refuses symmetrically unless the UTV2-1814 ownership marker is present, so
-- the pair can only ever create and remove the object this migration owns.
-- ─────────────────────────────────────────────────────────────────────────────
-- FAIL-CLOSED-PRECONDITION: public.insert_certification_propagation_batch(jsonb, jsonb)
DO $$
DECLARE
  v_existing oid := to_regprocedure('public.insert_certification_propagation_batch(jsonb, jsonb)');
  v_marker text := obj_description(v_existing, 'pg_proc');
BEGIN
  IF v_existing IS NOT NULL AND (v_marker IS NULL OR v_marker NOT LIKE 'UTV2-1814:%') THEN
    RAISE EXCEPTION USING
      -- 42723 duplicate_function: the routine analogue of the 42P07 duplicate_table
      -- that scripts/ci/migration-precondition-drill.ts requires of a relation guard.
      ERRCODE = '42723',
      MESSAGE = 'public.insert_certification_propagation_batch(jsonb, jsonb) already exists without the UTV2-1814 ownership marker; this migration refuses to replace an object it did not create.',
      HINT    = 'Inspect the existing function and its comment before re-running.';
  END IF;

  IF to_regclass('public.certification_records') IS NULL
     OR to_regclass('public.certification_transition_events') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42P01',
      MESSAGE = 'certification_records and certification_transition_events must both exist before this function can be created.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_certification_propagation_batch(
  p_records jsonb,
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  record_count integer;
  event_count integer;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' THEN
    RAISE EXCEPTION 'p_records must be a JSON array';
  END IF;

  IF jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'p_events must be a JSON array';
  END IF;

  record_count := jsonb_array_length(p_records);
  event_count := jsonb_array_length(p_events);

  IF record_count = 0 THEN
    RAISE EXCEPTION 'certification propagation batch cannot be empty';
  END IF;

  IF record_count <> event_count THEN
    RAISE EXCEPTION
      'certification propagation batch record/event count mismatch: records %, events %',
      record_count,
      event_count;
  END IF;

  INSERT INTO public.certification_records (
    id,
    program_id,
    domain,
    status,
    evidence_sha,
    merge_sha,
    transitioned_at,
    transitioned_by,
    transition_reason,
    expires_at,
    revocation_trigger,
    predecessor_id,
    created_at
  )
  SELECT
    record.id::uuid,
    record.program_id,
    record.domain::public.certification_domain,
    record.status::public.certification_status,
    record.evidence_sha,
    record.merge_sha,
    record.transitioned_at::timestamptz,
    record.transitioned_by,
    record.transition_reason,
    record.expires_at::timestamptz,
    record.revocation_trigger::public.revocation_trigger,
    record.predecessor_id::uuid,
    record.created_at::timestamptz
  FROM jsonb_to_recordset(p_records) AS record(
    id text,
    program_id text,
    domain text,
    status text,
    evidence_sha text,
    merge_sha text,
    transitioned_at text,
    transitioned_by text,
    transition_reason text,
    expires_at text,
    revocation_trigger text,
    predecessor_id text,
    created_at text
  );

  INSERT INTO public.certification_transition_events (
    id,
    cert_record_id,
    program_id,
    domain,
    from_status,
    to_status,
    triggered_by,
    trigger_reason,
    evidence_sha,
    occurred_at,
    replay_safe
  )
  SELECT
    event.id::uuid,
    event.cert_record_id::uuid,
    event.program_id,
    event.domain::public.certification_domain,
    event.from_status::public.certification_status,
    event.to_status::public.certification_status,
    event.triggered_by,
    event.trigger_reason,
    event.evidence_sha,
    event.occurred_at::timestamptz,
    event.replay_safe
  FROM jsonb_to_recordset(p_events) AS event(
    id text,
    cert_record_id text,
    program_id text,
    domain text,
    from_status text,
    to_status text,
    triggered_by text,
    trigger_reason text,
    evidence_sha text,
    occurred_at text,
    replay_safe boolean
  );

  RETURN jsonb_build_object(
    'records_inserted',
    record_count,
    'events_inserted',
    event_count
  );
END;
$$;

COMMENT ON FUNCTION public.insert_certification_propagation_batch(jsonb, jsonb) IS
  'UTV2-1814: atomically persists append-only certification propagation records and transition events. Body carried forward from UTV2-1177.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ACLs. REVOKE FROM PUBLIC alone is not sufficient on Supabase: `anon` and
-- `authenticated` hold grants in their own right, so revoking PUBLIC leaves a
-- browser-reachable SECURITY DEFINER writer. The roles are revoked by name, guarded by
-- pg_roles so this still applies on a scratch Postgres that has no Supabase roles.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.insert_certification_propagation_batch(jsonb, jsonb) FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.insert_certification_propagation_batch(jsonb, jsonb) FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.insert_certification_propagation_batch(jsonb, jsonb) TO service_role';
  END IF;
END;
$$;
