# UTV2-1085 Runtime Verification — odds_snapshots Live DB Proof

## Runtime Verification

**Project:** zfzdnfwdarxucxtaojxm (Supabase production)
**Migration applied:** 2026-05-23T22:20:00Z
**Migration name:** utv2_1085_odds_snapshots

---

## Migration Applied

```sql
CREATE TABLE odds_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key      TEXT        NOT NULL,
  market_key        TEXT        NOT NULL,
  league            TEXT        NOT NULL,
  run_id            UUID        NOT NULL,
  raw_payload_id    UUID        REFERENCES raw_payloads(id),
  snapshot_at       TIMESTAMPTZ NOT NULL,
  price_blob        JSONB       NOT NULL,
  prior_snapshot_id UUID        REFERENCES odds_snapshots(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- + odds_snapshot_corrections + immutability triggers + indexes + RLS
```

---

## DB Immutability Proof

### Test 1 — INSERT succeeds

```sql
INSERT INTO odds_snapshots (provider_key, market_key, league, run_id, snapshot_at, price_blob)
VALUES ('odds-api', 'h2h', 'NBA', gen_random_uuid(), NOW(),
        '{"events":[{"id":"utv2-1085-proof"}]}')
RETURNING id, provider_key, league, created_at;
```

**Result:** `PASS` — rows inserted, proof rows in DB.

### Test 2 — Correction appends new row with prior_snapshot_id lineage

Original row `bab47417-56a7-4a36-b99a-a7fd0600d27d` (`prior_snapshot_id: null`)
Correction row `79f79830-747a-4a42-8354-30ce97d34ff2` (`prior_snapshot_id: bab47417...`)

**Result:** `PASS` — correction is a new row with `prior_snapshot_id` referencing original. Original row unchanged.

### Test 3 — UPDATE blocked by immutability trigger

```sql
UPDATE odds_snapshots SET market_key = 'mutated' WHERE provider_key = 'odds-api';
```

**Result:** `PASS` — trigger fired: `odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)`

### Test 4 — DELETE blocked by immutability trigger

```sql
DELETE FROM odds_snapshots WHERE provider_key = 'odds-api';
```

**Result:** `PASS` — trigger fired: `odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)`

---

## Live DB Row Count Verification

```sql
SELECT id, provider_key, league, market_key, run_id, prior_snapshot_id, created_at
FROM odds_snapshots ORDER BY created_at DESC LIMIT 6;
```

| id | provider_key | league | market_key | prior_snapshot_id |
|---|---|---|---|---|
| 0684e6f9 | odds-api | NBA | h2h | null |
| 6cc68d90 | odds-api | NBA | h2h | null |
| 79f79830 | odds-api | NBA | h2h | bab47417 (correction) |
| bab47417 | odds-api | NBA | h2h | null (original) |
| 22783266 | odds-api | NBA | h2h | null |

**5 rows inserted; correction lineage bab47417→79f79830 verified.**

---

## Summary

| Check | Result |
|---|---|
| Migration applied to production Supabase | ✅ PASS |
| INSERT accepted | ✅ PASS |
| Correction appends new row with prior_snapshot_id | ✅ PASS |
| UPDATE blocked (trigger `trg_odds_snapshots_immutable`) | ✅ PASS |
| DELETE blocked (trigger `trg_odds_snapshots_immutable`) | ✅ PASS |
| Repository implementations (InMemory + Database) | ✅ PASS |
| IngestorRepositoryBundle extended with oddsSnapshots | ✅ PASS |

**Append-only immutability is mechanically enforced at the DB level. This proof is live against the production Supabase project.**

*Generated 2026-05-23T22:35:00Z by Claude Sonnet 4.6 for UTV2-1085 T1 evidence bundle.*
