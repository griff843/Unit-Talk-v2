-- Down script for 20260527002_utv2_1116_immutable_model_version_artifact_sha
-- Reverts: removes artifact_sha column from model_registry and drops the
-- immutability trigger + trigger function introduced by UTV2-1116.
--
-- WARNING: Applying this down script drops the artifact_sha column and any
-- data stored there. This is destructive and irreversible in production.
-- This script is provided for round-trip drill verification only.

DROP TRIGGER IF EXISTS trg_model_registry_artifact_sha_immutable ON model_registry;

DROP FUNCTION IF EXISTS model_registry_artifact_sha_immutable();

ALTER TABLE model_registry
  DROP COLUMN IF EXISTS artifact_sha;
