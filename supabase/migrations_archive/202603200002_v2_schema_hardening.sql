-- =============================================================================
-- V2 Schema Hardening
-- Migration: 202603200002_v2_schema_hardening
-- Track: Supabase / Schema
--
-- Purpose
-- -------
-- Hardens the V2 foundation schema by:
--   1. Adding updated_at trigger function and attaching to mutable tables.
--   2. Aligning pick_lifecycle columns with the TypeScript repository interface
--      (rename lifecycle_state → to_state, add from_state, add CHECK constraint).
--   3. Adding created_at and idempotency_key to system_runs.
--   4. Adding claim columns and idempotency_key to distribution_outbox.
--   5. Adding channel to distribution_receipts for distinct delivery identity.
--   6. Adding corrects_id to settlement_records for additive correction support.
--   7. Adding entity_ref to audit_log for non-UUID entity references.
--   8. Making audit_log immutable via a before-mutation trigger.
--
-- Rollback notes (manual, no automated rollback in Supabase migrations)
-- -----------------------------------------------------------------------
-- To undo trigger additions:   DROP TRIGGER ... ON <table>; DROP FUNCTION ...;
-- To undo column additions:     ALTER TABLE ... DROP COLUMN IF EXISTS <col>;
-- To undo to_state rename:      ALTER TABLE pick_lifecycle RENAME COLUMN to_state TO lifecycle_state;
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. updated_at trigger function
--    Creates a shared trigger function that sets updated_at = now() on each row
--    update. Attached to every table with an updated_at column.
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

create trigger picks_set_updated_at
  before update on public.picks
  for each row execute function public.set_updated_at();

create trigger participants_set_updated_at
  before update on public.participants
  for each row execute function public.set_updated_at();

create trigger participant_memberships_set_updated_at
  before update on public.participant_memberships
  for each row execute function public.set_updated_at();

create trigger distribution_outbox_set_updated_at
  before update on public.distribution_outbox
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. pick_lifecycle column alignment
--    The TypeScript PickLifecycleRecord interface uses:
--      - from_state (the state before the transition, nullable)
--      - to_state   (the state after the transition, required)
--    The foundation migration used `lifecycle_state` for what is semantically
--    `to_state`. This rename aligns SQL with the repository contract.
-- -----------------------------------------------------------------------------

alter table public.pick_lifecycle
  rename column lifecycle_state to to_state;

alter table public.pick_lifecycle
  add column if not exists from_state text;

alter table public.pick_lifecycle
  -- lint-override: sibling-constraint
  add constraint pick_lifecycle_to_state_check check (
    to_state in ('draft', 'validated', 'queued', 'posted', 'settled', 'voided')
  );

-- Composite index for state machine queries: "what was the last known state of this pick?"
create index if not exists pick_lifecycle_pick_state_idx
  on public.pick_lifecycle(pick_id, to_state);


-- -----------------------------------------------------------------------------
-- 3. system_runs additions
--    - created_at: insertion timestamp, distinct from started_at (which may be
--      set to a past time by the caller). Enables accurate ordering of run records.
--    - idempotency_key: optional caller-supplied key to prevent duplicate run
--      records for the same logical operation.
--    - Index on (run_type, status) for operator dashboard queries.
-- -----------------------------------------------------------------------------

alter table public.system_runs
  add column if not exists created_at timestamptz not null default timezone('utc', now());

alter table public.system_runs
  add column if not exists idempotency_key text;

create unique index if not exists system_runs_idempotency_key_idx
  on public.system_runs(idempotency_key)
  where idempotency_key is not null;

create index if not exists system_runs_run_type_status_idx
  on public.system_runs(run_type, status);


-- -----------------------------------------------------------------------------
-- 4. distribution_outbox claim columns + idempotency
--    - claimed_at / claimed_by: support SELECT FOR UPDATE SKIP LOCKED outbox
--      worker pattern. A claimed row should only be owned by one worker process.
--    - idempotency_key: caller-supplied key to prevent double-enqueue. A unique
--      partial index enforces uniqueness only when the key is present.
--    Decision: idempotency_key (Option A) is used rather than unique(pick_id, target)
--    because a pick may legitimately need re-delivery to the same target after
--    a failed run (e.g., after a dead-letter is manually re-queued).
-- -----------------------------------------------------------------------------

alter table public.distribution_outbox
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists idempotency_key text;

create unique index if not exists distribution_outbox_idempotency_key_idx
  on public.distribution_outbox(idempotency_key)
  where idempotency_key is not null;

-- Partial index for stale-claim detection: find rows stuck in 'processing'
create index if not exists distribution_outbox_claimed_at_processing_idx
  on public.distribution_outbox(claimed_at)
  where status = 'processing';


-- -----------------------------------------------------------------------------
-- 5. distribution_receipts: add channel column
--    Receipts need a distinct channel identity separate from receipt_type so
--    that the distribution contract can track delivery per channel (e.g.,
--    discord:#picks-general vs discord:#premium-picks).
-- -----------------------------------------------------------------------------

alter table public.distribution_receipts
  add column if not exists channel text;

create index if not exists distribution_receipts_channel_idx
  on public.distribution_receipts(channel)
  where channel is not null;


-- -----------------------------------------------------------------------------
-- 6. settlement_records: add corrects_id for additive correction support
--    The settlement contract requires that corrections create new records rather
--    than mutating existing ones. corrects_id is a self-referential FK that
--    links a correction record to the original settlement record it supersedes.
--    null = original record, non-null = correction.
-- -----------------------------------------------------------------------------

alter table public.settlement_records
  add column if not exists corrects_id uuid
    references public.settlement_records(id) on delete restrict;

create index if not exists settlement_records_corrects_id_idx
  on public.settlement_records(corrects_id)
  where corrects_id is not null;


-- -----------------------------------------------------------------------------
-- 7. audit_log: add entity_ref for non-UUID entity references
--    audit_log.entity_id is typed uuid, which cannot hold external string IDs
--    (e.g., Discord message IDs, external run references). entity_ref text
--    provides a parallel reference for non-UUID entities. One of entity_id or
--    entity_ref should be populated per row; both may be null for global events.
-- -----------------------------------------------------------------------------

alter table public.audit_log
  add column if not exists entity_ref text;

create index if not exists audit_log_entity_ref_idx
  on public.audit_log(entity_ref)
  where entity_ref is not null;


-- -----------------------------------------------------------------------------
-- 8. audit_log immutability trigger
--    The run and audit contract requires audit records to be append-only.
--    This trigger rejects any UPDATE or DELETE on audit_log rows at the
--    database layer, preventing accidental or malicious mutation.
-- -----------------------------------------------------------------------------

create or replace function public.reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_log is immutable: UPDATE and DELETE are not permitted on this table. '
    'Create a new audit record instead.';
end;
$$;

create trigger guard_audit_log_immutability
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_log_mutation();
