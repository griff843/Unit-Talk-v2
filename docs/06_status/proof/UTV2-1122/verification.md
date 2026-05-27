# Verification: UTV2-1122 — Cohort-Level Holds (INIT-3.3.3)

## Verification

- **Tier:** T1
- **Verifier:** claude-sonnet-4-6 (orchestrator)
- **Implementation SHA:** 54bb1f89e3dbc72e9c52fd8329b8104233d0fec6
- **Merge SHA:** c117eb28d84b32289700f0ba4b3ff9507e11d6ff

## Static proof

| Check | Result |
|---|---|
| pnpm verify | PASS (208/208 tests in domain-features suite) |
| type-check | PASS |
| lint | PASS |
| build | PASS |
| R-level check | PASS (no R-level artifacts required) |

## Live-DB proof

`pnpm test:db` — 7/7 PASS against live Supabase (`zfzdnfwdarxucxtaojxm`)

Duration: 25652 ms

## Implementation summary

`packages/domain/src/models/cohort-hold.ts` implements INIT-3.3.3:

- `CohortKey` — `{ sport, market_type }` cohort identity; `cohortKeyString()` → `"nba:spread"` format
- `CohortHold` — per-cohort hold record; `blocks_scoring_for_cohort: true` always set
- `evaluateCohortHolds()` — evaluates all cohorts against shared thresholds; each breaching cohort produces an independent CohortHold
- `isCohortHeld()` — per-cohort scoring gate; callers check before scoring a pick
- Missing metric in cohort readings fails closed (treated as violation)
- All cohort hold decisions emit `CohortHoldAuditEvent` as append-only records

**Required invariants satisfied:**
- Cohort degradation triggers cohort-level hold (not full model hold)
- Multiple cohorts can be held simultaneously; others remain active
- Cohort metrics reproducible from stored inputs (pure + deterministic)
- All hold decisions auditable (entity_id: `{model}@{version}:{sport}:{market_type}`)

## Adversarial validation

3 adversarial tests tagged `[ADVERSARIAL]`:
1. Cohort-only degradation (NBA spread breaches, others healthy) → cohort hold fires; other cohorts remain active
2. Multi-cohort degradation → each breaching cohort fires independently
3. Missing cohort metric → fails closed, hold fires
