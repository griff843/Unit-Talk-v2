-- UTV2-735: align experiment_ledger.run_type DB contract with schema.ts.
alter table public.experiment_ledger
  drop constraint if exists experiment_ledger_run_type_check;

alter table public.experiment_ledger
  add constraint experiment_ledger_run_type_check check (
    run_type in ('training', 'eval', 'backtest', 'calibration', 'shadow_comparison')
  );
