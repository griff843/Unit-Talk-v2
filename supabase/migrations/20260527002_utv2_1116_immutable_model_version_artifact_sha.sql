-- UTV2-1116: Add artifact_sha to model_registry with immutability enforcement
-- Once a model version is registered with an artifact_sha, it cannot be changed.
-- A changed version is a new record, not an update to an existing one.

ALTER TABLE model_registry
  ADD COLUMN IF NOT EXISTS artifact_sha TEXT;

COMMENT ON COLUMN model_registry.artifact_sha IS
  'SHA-256 of the model artifact file. Immutable once set — a changed artifact is a new model version record.';

-- Trigger function: prevent UPDATE on artifact_sha once it has been set.
CREATE OR REPLACE FUNCTION model_registry_artifact_sha_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.artifact_sha IS NOT NULL
     AND NEW.artifact_sha IS DISTINCT FROM OLD.artifact_sha THEN
    RAISE EXCEPTION
      'artifact_sha is immutable once set on model_registry (id=%). A changed artifact must be registered as a new model version.',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_model_registry_artifact_sha_immutable ON model_registry;

CREATE TRIGGER trg_model_registry_artifact_sha_immutable
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION model_registry_artifact_sha_immutable();
