# UTV2-1084 Runtime Verification — raw_payloads Live DB Proof

## Runtime Verification

**Project:** zfzdnfwdarxucxtaojxm (Supabase production)
**Migration applied:** 2026-05-23T19:04:00Z
**Migration name:** utv2_1084_raw_payload_store

---

## Migration Applied

```sql
CREATE TABLE raw_payloads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT        NOT NULL,
  league       TEXT        NOT NULL,
  run_id       UUID        NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('odds', 'results')),
  payload_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  snapshot_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- + immutability triggers + indexes + RLS
```

---

## DB Immutability Proof

### Test 1 — INSERT succeeds

```sql
INSERT INTO raw_payloads (provider_key, league, run_id, kind, payload_hash, payload, snapshot_at)
VALUES ('odds-api', 'NBA', gen_random_uuid(), 'odds',
        'abc123deadbeef...', '{"events":[{"id":"utv2-1084-proof"}]}', NOW())
RETURNING id, provider_key, league, kind, payload_hash, created_at;
```

**Result:** `PASS` — row inserted with id `b7543b37-232c-4223-b767-a07ecd392b31`

### Test 2 — UPDATE blocked by immutability trigger

```sql
UPDATE raw_payloads SET payload_hash = 'mutated' WHERE provider_key = 'odds-api';
```

**Result:** `PASS` — trigger fired: `raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)`

### Test 3 — DELETE blocked by immutability trigger

```sql
DELETE FROM raw_payloads WHERE provider_key = 'odds-api';
```

**Result:** `PASS` — trigger fired: `raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)`

### Test 4 — Row integrity preserved after attempted mutations

Re-read after UPDATE and DELETE attempts — original row unchanged:

```json
{
  "id": "b7543b37-232c-4223-b767-a07ecd392b31",
  "provider_key": "odds-api",
  "league": "NBA",
  "kind": "odds",
  "payload_hash": "abc123deadbeef0000000000000000000000000000000000000000000000000000",
  "created_at": "2026-05-23T19:04:57.133Z"
}
```

**Result:** `PASS` — hash unchanged, row not deleted, append-only invariant enforced.

---

## Repository Failure Propagation Proof

`DatabaseRawPayloadRepository.insert()` propagates Supabase client errors directly:

```typescript
if (error || !data) {
  throw new Error(`raw_payloads insert failed: ${error?.message ?? 'unknown error'}`);
}
```

Integration test `ingest-odds-api.test.ts` — "archive failure blocks ingestion when mode is fail_closed":
- `ThrowingRawPayloadRepository` throws on insert
- `ingestOddsApiLeague` returns `status: 'failed'`, `error: 'archive failure: DB archive failure — simulated'`
- **PASS** (4/4 integration tests green)

---

## Summary

| Check | Result |
|---|---|
| Migration applied to production Supabase | ✅ PASS |
| INSERT accepted | ✅ PASS |
| UPDATE blocked (trigger `raw_payloads_immutable`) | ✅ PASS |
| DELETE blocked (trigger `raw_payloads_immutable`) | ✅ PASS |
| Row integrity preserved after mutation attempts | ✅ PASS |
| Repository error propagation | ✅ PASS (via integration test) |

**Append-only immutability is mechanically enforced at the DB level. This proof is live against the production Supabase project.**

---

*Generated 2026-05-23T19:10:00Z by Claude Sonnet 4.6 for UTV2-1084 T1 evidence bundle.*
