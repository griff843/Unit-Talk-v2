-- UTV2-1981: support the keyset population guard's watermark and change probe.
-- Execute as a standalone statement with autocommit enabled. PostgreSQL forbids
-- CREATE INDEX CONCURRENTLY inside a transaction block. Do not wrap this file
-- in BEGIN/COMMIT or combine it with other statements in one execution request.
-- Production execution requires a separate Griff authorization packet.
-- Deliberately fail on name collision: IF NOT EXISTS could hide an invalid or
-- differently defined index left by a failed concurrent build. Inspect first.
-- FAIL-CLOSED-PRECONDITION: public.picks_updated_at_idx
CREATE INDEX CONCURRENTLY picks_updated_at_idx ON public.picks USING btree (updated_at);
