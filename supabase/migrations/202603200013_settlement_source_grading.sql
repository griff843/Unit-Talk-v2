-- Migration 013: extend settlement_records_source_check to include 'grading'
-- Required by grading-service (T1 Automated Grading, UTV2-28).

alter table public.settlement_records
  drop constraint settlement_records_source_check,
  add constraint settlement_records_source_check check (
    source in ('operator', 'api', 'feed', 'grading')
  );
