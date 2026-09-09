-- UTV2-183: Submission idempotency — prevent duplicate picks on retry/double-click
ALTER TABLE picks ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS picks_idempotency_key_idx ON picks (idempotency_key) WHERE idempotency_key IS NOT NULL;
