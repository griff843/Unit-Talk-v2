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

## UTV2-1227 — Downstream Activation Patch (2026-06-07)

### Change

Added `SYNDICATE_MACHINE_ENABLED=true` to `.github/workflows/deploy.yml` production env section.

### Root cause

Board scan in `apps/api/src/index.ts` is gated: `runBoardScan(deps, { enabled: environment.SYNDICATE_MACHINE_ENABLED === 'true' })`. This flag was never set in any prior deploy.yml commit — board scan ran every 5 minutes with `enabled: false`, producing zero candidates, zero scoring, zero board.

### Verification (UTV2-1227 T1)

```
pnpm verify: PASS — 113 tests pass, 0 fail
pnpm test:db: PASS — 7/7 pass against live Supabase zfzdnfwdarxucxtaojxm
R-level: PASS — no required artifacts (2 changed files, no rules matched)
```

Full evidence: `docs/06_status/proof/UTV2-1227/verification.md`

## Summary

D-CONST-6 **ingestion dimension resolved**: live SGO offers are flowing into `provider_offer_current`. Wave-5 materializer FRESH (Market Universe confirmed).

D-CONST-6 **downstream activation**: `SYNDICATE_MACHINE_ENABLED=true` patched in UTV2-1227. Post-deploy freshness of Candidates/Scoring/Board required to close fully.
