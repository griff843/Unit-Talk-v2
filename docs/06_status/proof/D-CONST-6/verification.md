# D-CONST-6 Verification — Live Ingestion Freshness Restored

**Lane:** UTV2-1227 | **Date:** 2026-06-07 | **Tier:** T1

## Verification

### pnpm verify

```
pnpm verify — PASS (exit 0)
```

Confirmed on b4188980 (current main HEAD), 2026-06-07.

### pnpm test:db

```
# tests 7
# pass  7
# fail  0
```

Confirmed against live Supabase project zfzdnfwdarxucxtaojxm, 2026-06-07.

### pnpm stage:freshness (Offers)

```
[✓] Offers  FRESH  age=4m  latest 4m ago, 1523 rows in window (threshold 60m)
```

Live SGO/NBA offers confirmed fresh in `provider_offer_current` (257,880 total rows, latest 2026-06-07T13:38:28Z).

### DB freshness queries

```sql
-- provider_offer_current
SELECT MAX(updated_at), COUNT(*) FROM provider_offer_current
-- Result: latest=2026-06-07T13:38:28Z, rows=257880

-- provider_offer_history (last 2h)
SELECT MAX(created_at), COUNT(*) FROM provider_offer_history WHERE created_at > NOW() - INTERVAL '2 hours'
-- Result: latest=2026-06-07T13:38:28Z, rows=1561
```

### Constitutional constraints verified

- SGO key used: existing key, no new subscription
- `P3 status`: ACTIVE_NOT_CERTIFIED (unchanged)
- `P5 status`: FROZEN_NOT_CERTIFIED (unchanged)
- `UTV2-1042`: remains data-gated
- No edge, CLV, ROI, or production-readiness claim made
- No secret values in any proof artifact

## Summary

D-CONST-6 **ingestion dimension resolved**: live SGO offers are flowing into `provider_offer_current`. The `stage:freshness` Offers check passes at age ~4 minutes. The downstream pipeline (Market Universe, Candidates, Scoring, Board) remains stale pending full Hetzner re-deploy with Wave-5 code (deploy run 27094264485 triggered 2026-06-07T13:42:52Z).

D-CONST-6 is not fully closed until the downstream pipeline is also verified FRESH post-deploy.
