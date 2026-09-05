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

-- ─────────────────────────────────────────────────────────────────────────────
-- OWNERSHIP PRECONDITION — must remain the first executable statement.
--
-- A bare DROP ... IF EXISTS drops whatever happens to carry the name, which is not the
-- same thing as undoing this migration. If an object of the same name was created out
-- of band, this script would silently destroy someone else's table and its rows while
-- reporting success.
--
-- The up-migration stamps both objects with a UTV2-1811 comment, so ownership is
-- recorded in the catalog rather than assumed. This refuses unless both stamps are
-- present, which is exactly the state the up-migration leaves behind and is not a state
-- an unrelated object would arrive in by accident. The up-migration's own fail-closed
-- precondition already refuses to apply over pre-existing objects, so together the two
-- guards mean this script can only ever remove objects this migration created.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- to_regclass / to_regprocedure return NULL rather than raising when the object is
  -- absent, so this reports a missing object as a refusal instead of failing with an
  -- undefined-object error that would read like a broken script. to_regprocedure also
  -- pins the exact callable identity; comparing pg_get_function_identity_arguments to a
  -- type-only string does NOT work, because that output carries parameter names.
  v_table oid := to_regclass('public.rate_limit_buckets');
  v_function oid := to_regprocedure('public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer)');
  v_table_marker text := obj_description(v_table, 'pg_class');
  v_function_marker text := obj_description(v_function, 'pg_proc');
BEGIN

  IF v_table_marker IS NULL OR v_table_marker NOT LIKE 'UTV2-1811:%' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'public.rate_limit_buckets does not carry the UTV2-1811 ownership marker; this rollback refuses to drop an object it did not create.',
      HINT    = 'Inspect the table and its comment. Roll it back by whatever created it.';
  END IF;

  IF v_function_marker IS NULL OR v_function_marker NOT LIKE 'UTV2-1811:%' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer) is absent or does not carry the UTV2-1811 ownership marker; this rollback refuses to drop an object it did not create.',
      HINT    = 'Inspect the function and its comment. Roll it back by whatever created it.';
  END IF;
END;
$$;

-- Unqualified DROPs, deliberately. The guard above has already established that both
-- objects exist and are this migration's, so IF EXISTS here would only serve to hide a
-- disagreement between the guard and the DROP.
-- lint-override: drop-table
DROP FUNCTION public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer);
DROP TABLE public.rate_limit_buckets;
