-- UTV2-1811: shared rate-limit bucket store for the API submission limiter.
--
-- ## Why this exists
--
-- `assertProductionRateLimitConfig` (apps/api/src/server.ts) refuses to start a
-- production-like API runtime on the in-memory rate limit store, so production runs
-- `UNIT_TALK_API_RATE_LIMIT_STORE=supabase_rpc`. That store's only operation is
--
--     client.rpc('consume_rate_limit_bucket', { p_key, p_window_start,
--                                               p_window_expires_at, p_limit })
--
-- and it fails closed — it throws rather than admitting a request — when the call
-- returns an error or no row. The function was specified in a code comment
-- (SupabaseRpcApiRateLimitStore) but was never written into a governed migration, so
-- it exists in no environment. Every authenticated submission therefore threw before
-- reaching handleSubmitPick: the limiter was not degraded, it was absent, and the
-- fail-closed contract turned that into a total submission outage.
--
-- This migration supplies the missing contract. It does not change, relax, or add a
-- fallback to the limiter: the store stays fail-closed, and a database that lacks
-- these objects still refuses traffic exactly as it does today.
--
-- ## Semantics
--
-- The function must be observationally equivalent to InMemoryApiRateLimitStore:
--   * every call increments the bucket for (key, window_start);
--   * `exceeded` is count > limit, so the limit-th request is allowed and the
--     (limit+1)-th is refused;
--   * `remaining` is clamped at zero;
--   * `reset_at` is the end of the caller's window.
-- The caller floors `now` to the window boundary, so a new window is a new row rather
-- than a mutation of the old one — which is what makes a single INSERT ... ON CONFLICT
-- both the increment and the window roll, with no read-modify-write race.
--
-- ## Authorization boundary
--
-- Machine-readable declaration consumed by scripts/ci/migration-precondition-drill.ts.
-- CI seeds the relation and requires this migration to refuse with SQLSTATE 42P07
-- before any DDL runs.
--
-- The guard is not ceremony. `rate_limit_buckets` is a plausible name for an object
-- created out of band, and this migration's whole value is that the table's shape
-- matches what consume_rate_limit_bucket assumes. Applying over a pre-existing table
-- of unknown shape would leave a function silently bound to the wrong columns — a
-- fail-closed limiter reporting nonsense — which is worse than refusing.
-- FAIL-CLOSED-PRECONDITION: public.rate_limit_buckets

-- ─────────────────────────────────────────────────────────────────────────────
-- FAIL-CLOSED PRECONDITION — must remain the first executable statement.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.rate_limit_buckets') IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42P07',
      MESSAGE = 'public.rate_limit_buckets already exists; UTV2-1811 refuses to apply over a relation it did not create.',
      HINT    = 'Inspect the existing relation. If it already matches this migration, register this version as applied (supabase migration repair --status applied) under explicit operator authorization instead of executing it.';
  END IF;
END;
$$;

CREATE TABLE public.rate_limit_buckets (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (key, window_start),
  CONSTRAINT rate_limit_buckets_count_non_negative CHECK (count >= 0),
  CONSTRAINT rate_limit_buckets_window_ordered CHECK (expires_at > window_start)
);

COMMENT ON TABLE public.rate_limit_buckets IS
  'UTV2-1811: per-(key, window) request counters backing SupabaseRpcApiRateLimitStore. Written only through consume_rate_limit_bucket().';

-- Supports the per-key expiry sweep inside consume_rate_limit_bucket(). The primary
-- key already covers (key, window_start); this index makes the sweep's key + expiry
-- predicate an index scan rather than a scan of every window ever recorded for the key.
CREATE INDEX rate_limit_buckets_key_expires_at_idx
  ON public.rate_limit_buckets (key, expires_at);

-- No policies are defined, so RLS denies every non-superuser role that does not bypass
-- it. The API reaches this table through the service-role client only. Enabling RLS
-- with zero policies is the deny-by-default posture, not an oversight.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_bucket(
  p_key text,
  p_window_start timestamptz,
  p_window_expires_at timestamptz,
  p_limit integer
)
RETURNS TABLE (
  exceeded boolean,
  "limit" integer,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- A non-positive limit would make every request "allowed" on the first call and is
  -- never something the caller intends. Refusing is the fail-closed reading: the store
  -- turns any error into a refusal, so a misconfigured limit blocks rather than admits.
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'consume_rate_limit_bucket requires p_limit >= 1';
  END IF;

  IF p_key IS NULL OR p_window_start IS NULL OR p_window_expires_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'consume_rate_limit_bucket requires non-null p_key, p_window_start and p_window_expires_at';
  END IF;

  -- Bounded, per-key sweep of windows this key has already left behind. Scoped to
  -- p_key deliberately: a table-wide DELETE would put concurrent callers for unrelated
  -- keys in each other's way for no benefit, and the row set a key can accumulate is
  -- what actually needs bounding.
  DELETE FROM public.rate_limit_buckets b
   WHERE b.key = p_key
     AND b.expires_at <= p_window_start;

  INSERT INTO public.rate_limit_buckets AS b (key, window_start, count, expires_at)
  VALUES (p_key, p_window_start, 1, p_window_expires_at)
  ON CONFLICT ON CONSTRAINT rate_limit_buckets_pkey
  DO UPDATE SET count = b.count + 1
  RETURNING b.count INTO v_count;

  RETURN QUERY
  SELECT
    v_count > p_limit,
    p_limit,
    GREATEST(p_limit - v_count, 0),
    p_window_expires_at;
END;
$$;

COMMENT ON FUNCTION public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer) IS
  'UTV2-1811: atomically increments the (key, window_start) bucket and reports whether the caller exceeded p_limit. Mirrors InMemoryApiRateLimitStore semantics.';

-- Least privilege. The API calls this with the service-role key, which bypasses both
-- RLS and these grants; no browser-facing role has any business burning or inspecting
-- rate-limit state.
--
-- REVOKE FROM PUBLIC alone is not sufficient on Supabase: `anon` and `authenticated`
-- hold EXECUTE as explicit ACL entries granted through ALTER DEFAULT PRIVILEGES, which
-- a PUBLIC revoke does not touch. Those roles do not exist in a scratch Postgres
-- container, so each revoke is guarded on the role's existence rather than assumed.
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer) FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.rate_limit_buckets FROM %I', role_name);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer) FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_buckets TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer) TO service_role';
  END IF;
END;
$$;
