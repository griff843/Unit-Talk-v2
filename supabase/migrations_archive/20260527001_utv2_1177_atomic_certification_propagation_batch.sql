-- UTV2-1177 — Atomic certification propagation batch persistence
--
-- Narrow RPC for certification revocation propagation batches.
-- The function performs append-only inserts only. Because PostgreSQL functions
-- execute inside one transaction, any record/event insert failure rolls back
-- the full propagation batch.

CREATE OR REPLACE FUNCTION public.insert_certification_propagation_batch(
  p_records jsonb,
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  'Atomically persists append-only certification propagation records and transition events.';
