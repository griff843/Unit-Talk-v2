-- Rollback for 20260901150000_utv2_1811_rate_limit_buckets.sql
--
-- Drops exactly what the forward migration created, in dependency order: the function
-- first (it reads and writes the table), then the table. The index, the primary key,
-- the two CHECK constraints and the RLS setting are owned by the table and go with it.
--
-- ## What reverting means operationally
--
-- Removing these objects does NOT restore the pre-UTV2-1811 behaviour of the API — it
-- restores the OUTAGE. SupabaseRpcApiRateLimitStore fails closed, so with the function
-- absent every authenticated submission throws before reaching handleSubmitPick. That is
-- the deliberate design of the limiter and is not changed here.
--
-- The consequence is that this rollback is only correct as part of reverting the whole
-- change (for example, a scratch round-trip drill, or backing out an application whose
-- corresponding code is also being backed out). It must never be run against an
-- environment that is serving submission traffic on the supabase_rpc store, because the
-- result is a total submission outage rather than a degraded one.
--
-- No data-loss override is claimed: rate-limit buckets are ephemeral per-window counters
-- with no downstream reader, so dropping the table destroys nothing that must survive.
-- A rolled-back-then-reapplied deployment starts every caller with a fresh window, which
-- is strictly more permissive for at most one window and never admits more than the
-- configured limit within it.

-- lint-override: drop-table
DROP FUNCTION IF EXISTS public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer);
DROP TABLE IF EXISTS public.rate_limit_buckets;
