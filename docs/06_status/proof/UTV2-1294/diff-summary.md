# UTV2-1294 — Diff Summary

**Merge SHA:** `54ef1273b53138ed49bf64b7f5bc8857700d195b` · **PR:** #1048 · **Tier:** T2 · **Lane type:** runtime

## Files changed
- `apps/ingestor/src/archive-payload-guard.ts` (new) — pure guard helpers: size measurement, oversize check, compact `payload_too_large` metadata builder, `withArchiveWriteTimeout`, env-overridable cap/timeout resolvers, `sha256Hex`.
- `apps/ingestor/src/archive-payload-guard.test.ts` (new) — unit tests for the helpers.
- `apps/ingestor/src/raw-provider-payload-archive.ts` — size guard + compact metadata + bounded write timeout in `archiveRawProviderPayload`; result now reports `oversized`/`payloadBytes`; structured `ARCHIVE_PAYLOAD_TOO_LARGE` log.
- `apps/ingestor/src/raw-provider-payload-archive.test.ts` — added oversized-capped / hung-bounded / small-regression tests.
- `apps/ingestor/src/ingest-league.ts` — same guard + timeout for the parallel `odds_snapshots` insert; passes `eventIds` for provenance.
- `apps/ingestor/src/ingest-archive-isolation.test.ts` (new) — settlement path runs for ok/oversized/throw/hang archive outcomes.

## Change
1. **Size guard:** serialized archive payloads above the cap (default 1 MB, `UNIT_TALK_INGESTOR_MAX_ARCHIVE_PAYLOAD_BYTES`) are never inserted as a giant JSON value. A compact `{reason: payload_too_large, provider, league, kind, payloadBytes, payloadHash, snapshotAt, eventIds}` record is written to the existing jsonb column instead — **no migration**. The full body is still disk-spooled best-effort for forensics.
2. **Write timeout:** every archive DB write is raced against a short timeout (default 5 s, `UNIT_TALK_INGESTOR_ARCHIVE_WRITE_TIMEOUT_MS`) so it can never consume the 120 s `statement_timeout` window. On timeout the caller's existing fail-open handling runs.
3. **Coverage:** both archive write sites — `raw_payloads` archive and the parallel `odds_snapshots` insert — are guarded. Critical settlement writes are untouched and stay fail-closed.

## Behavioral impact (proven in prod)
- Before: 17.8 MB MLB odds blob → `raw_payloads insert ... canceling statement due to statement timeout` → settlement starved → `game_results` frozen ~40 h.
- After: oversized payload capped to compact metadata (logged once), statement_timeout/schema-cache storm = 0, `game_results` freeze broken (144 fresh rows). Remaining MLB throughput limit (240 s per-league deadline) is a separate durable follow-up.

## Tier rationale
T2 — additive runtime write-path isolation in the ingestor archive path. No migration, no schema change, no settlement/promotion/grading semantic change.
