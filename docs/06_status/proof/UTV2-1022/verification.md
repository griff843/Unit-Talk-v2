## Verification — UTV2-1022

Date: 2026-05-19
Branch: codex/utv2-1022-implement-computeriskscore
Executor: Codex (Claude claude-sonnet-4-6)

## pnpm verify

```
[sync-check] OK (per-issue): branch "codex/utv2-1022-implement-computeriskscore" <-> .ops/sync/UTV2-1022.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
ESLint: 0 errors, 0 warnings
TypeScript: 0 errors
Build: succeeded
Tests: 113 pass, 0 fail, 0 skip
Smart Form verify: pass
Commands check: pass
```

Result: GREEN

## Test Coverage for UTV2-1022

### New unit tests (packages/domain/src/risk-score.test.ts)
- absent fields produce neutral defaults ✓
- all valid fields compute correct composite ✓
- zero Kelly triggers hardBlock ✓
- riskScore < 10 triggers hardBlock ✓
- negative Kelly triggers hardBlock ✓
- aggressive Kelly sizing ✓
- calculateScore risk modifier ✓
- moderate Kelly ranges ✓
- lineMovement ranges ✓
- dispersion ranges ✓

### Integration tests passing
- golden-regression.test.ts: 5/5 ✓ (scores updated for risk modifier)
- promotion-edge-integration.test.ts: 46/46 ✓
- submission-service.test.ts: all ✓
- model-registry.test.ts: 18/18 ✓
- replayable-scoring.test.ts: 6/6 ✓
- promotion-conviction.test.ts: 5/5 ✓

## Type Check
packages/domain/src/promotion.ts: 0 errors
packages/contracts/src/promotion.ts: 0 errors
apps/api/src/promotion-service.ts: 0 errors

## pnpm test:db

Live-DB proof test: `apps/api/src/t1-proof-risk-score.test.ts`

Gated on SUPABASE_SERVICE_ROLE_KEY. Run against real Supabase:
```
UNIT_TALK_APP_ENV=local pnpm test:db
```

Expected: 2 tests pass (riskScore persistence, determinism). Skips automatically when credentials unavailable.
