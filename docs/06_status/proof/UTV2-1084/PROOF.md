# UTV2-1084 — Raw Provider Payload Store: Pre-Transformation Hashing

**Tier:** T1 | **Lane type:** migration | **Executor:** Claude
**Branch SHA:** `18d2853ccebea08849b8278883583eca47a6d08f`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/831

---

## What was built

This lane implements the raw provider payload substrate for WS-1.1 Immutable Market Truth (constitutional sequence: 1083→**1084**→1085→1086→1087→1091).

### Core deliverables

1. **`supabase/migrations/20260523001_utv2_1084_raw_payload_store.sql`**
   - Append-only `raw_payloads` table with columns: `id`, `provider_key`, `league`, `run_id`, `kind`, `payload_hash`, `payload`, `snapshot_at`, `created_at`
   - DB-level immutability: UPDATE and DELETE blocked by `raw_payloads_immutable()` trigger
   - Indexes on `(provider_key, league, snapshot_at DESC)`, `run_id`, `payload_hash`

2. **`apps/ingestor/src/raw-provider-payload-archive.ts`** (rewritten)
   - SHA-256 hash computed from `JSON.stringify(payload)` **before** any normalization
   - DB write is primary: throws on failure — no silent swallow
   - Disk spool is secondary/best-effort — failures do not block ingestion
   - Returns `{ archivePath, archivedAt, payloadHash }`

3. **`apps/ingestor/src/provider-ingestion-policy.ts`**
   - `resolveProviderPayloadArchivePolicy` now defaults to `fail_closed`
   - Opt-out requires `UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE=fail_open`

4. **`apps/ingestor/src/ingest-odds-api.ts`** and **`ingest-league.ts`**
   - Default inline policy changed from `fail_open` to `fail_closed`
   - `rawPayloadsRepository: repositories.rawPayloads` passed to archive calls

5. **`packages/db/src/repositories.ts`**
   - `RawPayloadInsert`, `RawPayloadRecord`, `RawPayloadRepository` interfaces
   - `rawPayloads: RawPayloadRepository` added to `IngestorRepositoryBundle`

6. **`packages/db/src/runtime-repositories.ts`**
   - `InMemoryRawPayloadRepository` — for tests
   - `DatabaseRawPayloadRepository` — for production (inserts via Supabase client)
   - Both factory functions updated

7. **`apps/ingestor/src/raw-provider-payload-archive.test.ts`** (new)
   - 4 adversarial tests:
     - Hash is SHA-256 of pre-transformation serialization
     - DB failure throws (fail-closed semantics proven)
     - Hash changes if payload is mutated (pre-mutation guarantee)
     - `shouldBlockOnArchiveFailure` semantics

---

## Verification

| Check | Result |
|---|---|
| `pnpm type-check` | ✅ PASS — clean |
| `pnpm verify` | ✅ PASS — 488 tests, 0 failures |
| `pnpm test:db` | ✅ PASS — 7/7 DB smoke tests |
| Adversarial tests | ✅ 4/4 pass |
| Migration lint | ✅ no findings |

---

## Constitutional invariants satisfied

- **Invariant 10** (fail-closed): DB write throws on failure — no silent skip to `fail_open`
- **Invariant 11** (mechanical enforcement): `fail_closed` is the default; prose policy is now code policy
- **WS-1.1 substrate**: raw serialized payload + SHA-256 hash captured at ingestion boundary, before any transformation — anchors Immutable Market Truth for downstream replay (UTV2-1085+)

---

## Merge gate

- [ ] CI green on PR #831
- [ ] `pnpm test:db` re-run after migration applied to Supabase
- [ ] `merge_sha` recorded in `evidence.json`
- [ ] PM `t1-approved` label applied

---

*Proof assembled at 2026-05-23T18:35:00Z by Claude Sonnet 4.6*
