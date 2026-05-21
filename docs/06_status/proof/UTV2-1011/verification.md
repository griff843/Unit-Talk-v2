# UTV2-1011 Verification

Merge SHA: (to be filled post-merge)

## Commands

```bash
pnpm type-check
```

Result: PASS.

```bash
pnpm test
```

Result: PASS — 481 tests, 0 fail, 0 skip.

```bash
pnpm stage:freshness
```

Result (post-fix):
```
[✓] Offers  FRESH  age=5m  latest 5m ago, 11854 rows in window (threshold 60m)
[✓] Market Universe  FRESH  age=2m
```
Offers: FRESH. Overall verdict DEGRADED/FAILED due to downstream pipeline stages (not offer-freshness related).

```bash
pnpm runtime:health
```

Result (post-fix):
```
✓ Provider Freshness  latest offer 5m ago
```
Provider Freshness: HEALTHY.

```bash
pnpm test:db
```

Result: PENDING (running; to be filled before PR opens).

## Live DB Evidence

Queried via Supabase MCP at 2026-05-21T12:17Z:

| Table | latest timestamp | rows | age |
|-------|-----------------|------|-----|
| `provider_offer_current` | 2026-05-21T12:12:56Z | 255,808 | ~5m |
| `provider_offer_history` | 2026-05-21T12:09:15Z | 648,410 | ~9m |
| `provider_offers` (legacy) | 2026-04-29T13:04:29Z | 8,191,206 | 31,628m |

## SGO Auth Verification

```bash
curl -s "https://api.sportsgameodds.com/v2/account/usage" -H "X-Api-Key: ${SGO_API_KEY}"
```

Result: 200 OK — `{"success":true,"data":{"isActive":true,"tier":"pro",...}}`

## Distinction: Auth vs Scheduler vs Architecture

- **SGO auth failure**: NO — API key returns 200 OK, `isActive: true`, pro tier
- **Scheduler failure**: NO — ingestor ran, wrote 255,808+ rows to `provider_offer_current`
- **Runtime failure**: NO — offer data flows correctly through ingestion pipeline
- **Architecture mismatch**: YES — health scripts queried `provider_offers.snapshot_at` (legacy, not updated post-UTV2-772 cutover) instead of `provider_offer_current.updated_at`
