--
-- UTV2-1427: delivery kill switch — a live, DB-backed, no-deploy-required
-- operational control distinct from the existing enabled/rolloutPct target
-- registry. One row per delivery target. Absence of a row is treated as
-- killed=true by the application layer (fail closed on missing/unreadable
-- state), so this default is a defense-in-depth backstop, not the only
-- fail-closed mechanism.
--

CREATE TABLE public.delivery_kill_switch (
    target text NOT NULL,
    killed boolean DEFAULT true NOT NULL,
    reason text,
    actor text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT delivery_kill_switch_pkey PRIMARY KEY (target)
);

COMMENT ON TABLE public.delivery_kill_switch IS
    'UTV2-1427: per-target live delivery kill switch. Read by the worker before dequeue. A missing row or read error must be treated as killed=true by the caller.';
