# Week 16 Contract — Settlement Downstream & Loss Attribution

**Status**: RATIFIED
**Created**: 2026-03-21
**Lane**: Implementation (Lane 1) + Verification (Lane 3)

---

## Objective

Make settlement truth propagate into downstream accounting surfaces. Salvage loss attribution from the old repo as pure computation. Provide the foundation for settlement-based performance analysis.

## Scope

### In Scope

1. **Outcome resolution** — port `resolveOutcome`, `isDirectionallyCorrect`, `computeFlatBetROI` from `unit-talk-production/apps/api/src/analysis/outcomes/outcome-resolver.ts` as pure V2-native functions
2. **Loss attribution** — port `classifyLoss`, `summarizeLossAttributions` from `unit-talk-production/apps/api/src/analysis/outcomes/loss-attribution.ts` as pure V2-native functions
3. **Settlement downstream truth** — new V2-native functions:
   - `resolveEffectiveSettlement` — given a chain of settlement records for a pick (with corrections via `corrects_id`), return the effective latest result
   - `computeSettlementSummary` — aggregate settlement outcomes into hit rate, flat-bet ROI, win/loss/push/void/cancelled counts
4. **Tests** — minimum 20 new tests covering all ported and new functions
5. **Integration** — re-export from `packages/domain/src/index.ts`

### Out of Scope (Non-Goals)

- No DB access, no I/O, no side effects in new **domain** code
- No `ScoredOutcome` port (requires `p_final`, `edge_final`, `score`, `tier` — fields V2 settlement records don't have)
- No `performance-report.ts` port (depends on `ScoredOutcome`)
- No `baseline-roi.ts` port (composes non-portable types)
- No `daily-rollup.ts` or `drift-detector.ts` port
- No RecapAgent, AnalyticsAgent, or BaseAgent resurrection
- No new API endpoints (existing `POST /api/picks/:id/settle` extended with downstream bundle)
- No broad operator-web rebuild (scoped to picks pipeline settlement resolution)
- No schema migrations
- No import of `@unit-talk/production` or old-repo modules at runtime
- No Week 17 work

## Destination

```
packages/domain/src/outcomes/
├── outcome-resolver.ts        PORT from old repo (3 functions, 1 type)
├── loss-attribution.ts        PORT from old repo (2 functions, 4 types, 2 constants)
├── settlement-downstream.ts   NEW V2-native (2 functions, 3+ types)
├── outcome-resolver.test.ts   NEW tests
├── loss-attribution.test.ts   NEW tests
├── settlement-downstream.test.ts  NEW tests
└── index.ts                   Re-exports
```

## Source Truth Hierarchy

1. V2 runtime code (`apps/api/src/settlement-service.ts`) — authoritative for settlement write path
2. V2 contracts (`packages/contracts/src/settlement.ts`) — authoritative for settlement types
3. V2 DB types (`packages/db/src/database.types.ts`) — authoritative for column shapes
4. Old repo pure modules — reference only; adapt naming and conventions to V2

## Salvage Rules

- Every ported function must be pure (no I/O, no DB, no side effects)
- Old sprint references in comments must be removed
- Function signatures may be adapted to V2 naming conventions
- All ported logic must be verified equivalent to the old source
- Old test patterns are NOT ported — write fresh V2-native tests using `node:test` + `node:assert/strict`

## Constraints

- Runtime leads docs — any claim about settlement truth must match running code
- No drift imports — nothing from `unit-talk-production` at runtime
- Additive design — domain modules are new files; runtime changes extend existing settlement code without removing prior behavior
- Fail-closed — functions return `{ ok: false, reason }` discriminated unions when computation cannot proceed
- Single lifecycle truth source — settlement result comes from `settlement_records` table, not `picks`
- Week-size discipline — three pure modules + tests, nothing more

## Acceptance Criteria

1. `pnpm test` passes with all new test files included
2. `pnpm lint` clean
3. `pnpm type-check` clean
4. `pnpm build` clean
5. Runtime changes scoped to settlement API path and operator-web picks pipeline only (see Addendum)
6. All ported functions verified equivalent to old source
7. All new functions are pure (no I/O grep returns 0 violations)
8. Minimum 20 new tests

## Verification Gates

```bash
pnpm test          # all tests pass including new outcome tests
pnpm lint          # clean
pnpm type-check    # clean
pnpm build         # clean
```

## Known Exclusions

| Module | Reason |
|--------|--------|
| `ScoredOutcome` type | Requires V2 fields that don't exist (`p_final`, `edge_final`, `score`, `tier`) |
| `performance-report.ts` | Depends on `ScoredOutcome` |
| `baseline-roi.ts` | Composes non-portable types |
| RecapAgent | Entangled with BaseAgent + Supabase |
| AnalyticsAgent | Entangled with BaseAgent + Supabase |
| `daily-rollup.ts` | Out of week scope |
| `drift-detector.ts` | Out of week scope |

## Addendum — Runtime Integration (2026-03-21)

Scope expanded beyond pure domain salvage to wire downstream truth into the live settlement path and operator-web. The following runtime files were modified or created:

| File | Change |
|------|--------|
| `apps/api/src/settlement-service.ts` | Added `SettlementDownstreamBundle`, `computeSettlementDownstreamBundle()`, `computeLossAttributionForPick()`. All three settlement branches now return a `downstream` bundle. |
| `apps/api/src/controllers/settle-pick-controller.ts` | **New.** Maps `downstream` bundle into the `POST /api/picks/:id/settle` response body. |
| `apps/api/src/handlers/settle-pick.ts` | **New.** Handler layer between router and controller. |
| `apps/operator-web/src/server.ts` | Added `buildEffectiveSettlementResultMap()` — picks pipeline now resolves effective corrected settlement via `corrects_id` chain instead of raw row result. |
| `packages/db/src/repositories.ts` | Added `listByPick(pickId)` to `SettlementRepository` interface. |
| `packages/db/src/runtime-repositories.ts` | Implemented `listByPick` in both in-memory and Supabase repositories. |

**What did NOT change**: No new API endpoints. No schema migrations. No recap, performance-report, or accounting rebuild. No old-repo runtime imports.

## Addendum B - Accepted Foundation Expansion (2026-03-21)

Week 16 expanded beyond the original three-module salvage slice. The following pure-computation foundation is now accepted as part of Week 16:

### Batch 1

- `packages/domain/src/market`
- `packages/domain/src/features`
- `packages/domain/src/models`
- `packages/domain/src/signals`

### Batch 2

- `packages/domain/src/bands`
- `packages/domain/src/calibration`
- `packages/domain/src/scoring`

### Batch 3

- additional pure modules under `packages/domain/src/outcomes`
- `packages/domain/src/evaluation`
- `packages/domain/src/edge-validation`
- `packages/domain/src/market/market-reaction.ts`

### Batch 4

- `packages/domain/src/rollups`
- `packages/domain/src/system-health`
- `packages/domain/src/outcomes/baseline-roi.ts`

### Batch 5

- `packages/domain/src/risk`
- `packages/domain/src/strategy`

## Superseded Exclusions

The following items are no longer excluded, because they are now accepted Week 16 foundation:

- `baseline-roi.ts`
- `daily-rollup.ts`
- `drift-detector.ts`
- Kelly sizing / risk computation
- strategy simulation foundation

These items remain out of scope for Week 16 closeout unless separately ratified as runtime work:

- recap surface rebuild
- performance / accounting surface rebuild
- new API endpoints outside the settlement path
- DB-coupled strategy execution surfaces
- post-Week-16 product widening

## Batch 5 Note

`packages/domain/src/strategy` remains intentionally commented out from the top-level domain index while the `americanToDecimal` naming collision is unresolved. The strategy foundation is accepted in-repo, but top-level export normalization still requires explicit handling.

## Closeout Rule

Batch 1 through Batch 5 are accepted as Week 16 foundation only.

Week 16 is not closed until:
1. independent verification is recorded
2. the required closeout artifacts under `docs/06_status/` are completed
3. repo docs, Notion, and Linear all reflect the same final Week 16 truth
