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

Date: 2026-05-19
Branch SHA: 8f20a1ac (pre-final commit)
Supabase project: zfzdnfwdarxucxtaojxm

### database-smoke.test.ts (pnpm test:db) — 7/7 PASS

```
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# tests 7 | pass 7 | fail 0
```

### t1-proof-risk-score.test.ts — 2/2 PASS

```
ok 1 - UTV2-1022: submitted pick persists riskScore and riskModifier in promotion history payload
ok 2 - UTV2-1022: risk scoring is deterministic — same inputs produce same promotion score
# tests 2 | pass 2 | fail 0
```

Result: GREEN — live Supabase verified, risk scoring persists to pick_promotion_history.payload.scoreInputs

Branch HEAD SHA: b2e13b15e4f650610dacf4268495e8b2d704dc94
