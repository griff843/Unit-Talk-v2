# UTV2-1086 Verification — INIT-1.1.3 Snapshot Cutover

## Verification

**Branch:** claude/utv2-1086-snapshot-cutover-point-in-time
**Date:** 2026-05-24
**Project:** zfzdnfwdarxucxtaojxm

### pnpm verify

```
pnpm verify — PASS
# tests 113 / pass 113 / fail 0 / skipped 0
type-check: PASS
lint: PASS
build: PASS
```

### T1 Live-DB Proof

```
UNIT_TALK_APP_ENV=local npx tsx --test apps/ingestor/src/t1-proof-utv2-1086-snapshot-cutover.test.ts

ok 1 - queryAtTimestamp: 50-timestamp point-in-time reconstruction  (12712ms)
ok 2 - queryAtTimestamp: returns null before earliest snapshot  (113ms)
ok 3 - queryAtTimestamp: adversarial — later snapshot not visible at earlier timestamp  (412ms)
# tests 3 / pass 3 / fail 0 / skipped 0
```

### Migration Verification

```sql
-- Applied to zfzdnfwdarxucxtaojxm
COMMENT ON TABLE public.provider_offer_current IS
  'DERIVED PROJECTION — not truth. ...';

-- Confirmed live:
SELECT obj_description('public.provider_offer_current'::regclass, 'pg_class');
-- → "DERIVED PROJECTION — not truth. Materialized hot-current view of provider odds,
--    maintained for pick-pipeline operational reads.
--    Canonical truth for point-in-time reconstruction is odds_snapshots (UTV2-1085).
--    Demoted per INIT-1.1.3 / UTV2-1086."
```

### R-level

```
Verdict: PASS — no R-level artifacts required for this diff
```
