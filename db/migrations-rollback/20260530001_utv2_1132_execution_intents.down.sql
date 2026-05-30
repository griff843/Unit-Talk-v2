-- Down script for 20260530001_utv2_1132_execution_intents
-- Reverts: drops execution_intents table, triggers, and trigger function
-- introduced by UTV2-1132 INIT-4.1.1.
--
-- WARNING: Applying this down script drops the execution_intents table and
-- all data stored there. This is destructive and irreversible in production.
-- This script is provided for round-trip drill verification only.

DROP TRIGGER IF EXISTS execution_intents_no_update ON public.execution_intents;
DROP TRIGGER IF EXISTS execution_intents_no_delete ON public.execution_intents;

DROP FUNCTION IF EXISTS public.execution_intents_immutable();

DROP TABLE IF EXISTS public.execution_intents CASCADE;
