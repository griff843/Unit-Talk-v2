-- Down script for 20260714120000_add_delivery_kill_switch
-- Reverts: drops the delivery_kill_switch table added by the up migration.
-- Safe to apply — the table has no dependents and holds no data other
-- than operator-set kill-switch toggles, which are re-creatable.

DROP TABLE IF EXISTS public.delivery_kill_switch;
