-- Down script for 20260523001_utv2_1084_raw_payload_store
-- Reverts: drops raw_payloads table, triggers, and immutability function.
--
-- CAUTION: This drops all archived raw provider payloads. Only apply in
-- non-production environments or after explicit data-preservation decision.
-- This table is append-only by design; the down script is provided for
-- migration round-trip drill verification and CI reversibility gate only.

DROP TABLE IF EXISTS raw_payloads CASCADE;

DROP FUNCTION IF EXISTS raw_payloads_immutable();
