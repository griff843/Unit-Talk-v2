-- Week 8 settlement runtime alignment.
-- This keeps settlement additive while distinguishing settled outcomes,
-- manual-review records, and correction links.

alter table public.settlement_records
  add column if not exists status text not null default 'settled',
  add column if not exists evidence_ref text,
  add column if not exists notes text,
  add column if not exists review_reason text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settlement_records'
      and column_name = 'confidence'
      and data_type <> 'text'
  ) then
    alter table public.settlement_records
      alter column confidence type text
      using case
        when confidence is null then 'pending'
        else 'confirmed'
      end;
  end if;
end $$;

update public.settlement_records
set confidence = 'pending'
where confidence is null;

alter table public.settlement_records
  alter column confidence set default 'confirmed',
  alter column confidence set not null,
  alter column result drop not null;

alter table public.settlement_records
  drop constraint if exists settlement_records_result_check,
  drop constraint if exists settlement_records_status_check,
  drop constraint if exists settlement_records_source_check,
  drop constraint if exists settlement_records_confidence_check,
  drop constraint if exists settlement_records_shape_check;

alter table public.settlement_records
  add constraint settlement_records_result_check check (
    result is null or result in ('win', 'loss', 'push', 'void', 'cancelled')
  ),
  add constraint settlement_records_status_check check (
    status in ('settled', 'manual_review')
  ),
  add constraint settlement_records_source_check check (
    source in ('operator', 'api', 'feed')
  ),
  add constraint settlement_records_confidence_check check (
    confidence in ('confirmed', 'estimated', 'pending')
  ),
  add constraint settlement_records_shape_check check (
    (
      status = 'settled'
      and result is not null
    ) or (
      status = 'manual_review'
      and result is null
      and review_reason is not null
    )
  );

create index if not exists settlement_records_status_idx
  on public.settlement_records(status);

create index if not exists settlement_records_pick_created_idx
  on public.settlement_records(pick_id, created_at desc);
