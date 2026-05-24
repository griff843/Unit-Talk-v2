-- UTV2-1086 rollback: remove derived-projection label from provider_offer_current
-- Removes the COMMENT ON TABLE applied by INIT-1.1.3.
-- The table itself and its data are unaffected; this is metadata-only.

COMMENT ON TABLE public.provider_offer_current IS NULL;
