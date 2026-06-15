-- Migration: set system_runs.finished_at using the server clock on terminal transitions.
--
-- Root cause: started_at is set by the DB default (server clock) on INSERT, but
-- finished_at was being set by new Date().toISOString() in the TypeScript layer
-- (client clock). Any clock skew between the application server and the database
-- server caused finished_at to end up earlier than started_at.
--
-- Fix: a BEFORE UPDATE trigger sets finished_at = now() (server clock) whenever
-- the status transitions from 'running' to a terminal state. The application layer
-- no longer needs to supply finished_at.

create or replace function public.set_system_run_finished_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('succeeded', 'failed', 'cancelled')
     and old.status = 'running'
  then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

create trigger system_runs_set_finished_at
  before update on public.system_runs
  for each row
  execute function public.set_system_run_finished_at();
