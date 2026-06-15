-- UTV2-797 / UTV2-774
-- Purpose: make provider ingestion failures queryable on provider_cycle_status
-- and preserve affected provider/sport/market scope separately from generic
-- last_error strings.

ALTER TABLE public.provider_cycle_status
  ADD COLUMN IF NOT EXISTS failure_category text NULL CHECK (
    failure_category IN (
      'provider_api_failure',
      'parse_failure',
      'zero_offers',
      'db_statement_timeout',
      'db_lock_timeout',
      'db_deadlock',
      'partial_market_failure',
      'stale_after_cycle',
      'archive_failure',
      'unknown_failure'
    )
  ),
  ADD COLUMN IF NOT EXISTS failure_scope text NULL CHECK (
    failure_scope IN ('cycle', 'provider', 'sport', 'market', 'archive', 'db')
  ),
  ADD COLUMN IF NOT EXISTS affected_provider_key text NULL,
  ADD COLUMN IF NOT EXISTS affected_sport_key text NULL,
  ADD COLUMN IF NOT EXISTS affected_market_key text NULL;

CREATE INDEX IF NOT EXISTS provider_cycle_status_failure_category_idx
  ON public.provider_cycle_status (failure_category, updated_at DESC)
  WHERE failure_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_cycle_status_failure_scope_idx
  ON public.provider_cycle_status (failure_scope, updated_at DESC)
  WHERE failure_scope IS NOT NULL;
