---
name: utv2-1262-diff-summary
description: Diff summary for UTV2-1262 — closing odds capture at settlement
metadata:
  type: runtime
  issue: UTV2-1262
  tier: T1
---

## Diff Summary — UTV2-1262

**Branch:** `claude/utv2-1262-restore-closing-odds-capture`  
**Commit:** `bd5cc35c6ab57256e2c026b5637c163514e6e564`
**Merge SHA:** `b51ffe22f690f8b46df29645a0229ec19705fe2e`  
**Files changed:** 8

### Changes

#### `apps/api/src/clv-service.ts`
- Exported new `ResolvedClosingLine` interface with all fields needed for `pick_offer_snapshots` insert
- Added `resolvedClosingLine?: ResolvedClosingLine` to `CLVComputationOutcome`
- Extended `resolveClosingLineFromPickProvenance` return to include `providerEventId` and `providerParticipantId`
- Populated `resolvedClosingLine` at both `status: 'computed'` return paths (market_universe and pinnacle/consensus)

#### `packages/db/src/repositories.ts`
- Added `PickOfferSnapshotInsertInput` interface
- Added `PickOfferSnapshotRepository` interface (insert, existsForPick, countByKind)
- Added `pickOfferSnapshots?: PickOfferSnapshotRepository` to `RepositoryBundle` (optional for backward compat)

#### `packages/db/src/runtime-repositories.ts`
- Added `InMemoryPickOfferSnapshotRepository` (array-backed, all 3 methods)
- Added `DatabasePickOfferSnapshotRepository` (Supabase client, from pick_offer_snapshots)
- Wired both into `createInMemoryRepositoryBundle()` and `createDatabaseRepositoryBundle()`

#### `apps/api/src/settlement-service.ts`
- Added `pickOfferSnapshots?: PickOfferSnapshotRepository` to both `recordGradedSettlement` and `recordEvidenceSettlement` repo parameter types
- Added private `writeClosingClvSnapshot` helper (fail-open: try/catch with audit, never propagates)
- Called with `.catch(() => undefined)` at both settlement entry points

#### `apps/api/src/persistence.ts`
- Added `InMemoryPickOfferSnapshotRepository` to re-exports

#### `apps/api/src/settlement-service.test.ts`
- 4 new tests: fail-open, no-CLV-no-snapshot, InMemory insert/existsForPick, InMemory countByKind

#### `apps/api/src/scripts/utv2-1262-proof.ts` (NEW)
- Live-DB proof script: counts closing_for_clv rows, linked rows, all snapshot kinds, sample CLV-path rows

#### `apps/api/src/scripts/utv2-1262-backfill-closing-clv.ts` (NEW)
- Dry-run backfill analysis: 173 resolvable from payload CLV data out of 495 eligible records
- `--live` flag exists but not implemented (requires separate PM approval)

### Root cause addressed

`pick_offer_snapshots.closing_for_clv` write path was architecturally specified in the T1 production readiness contract but never wired in `settlement-service.ts`. CLV computation worked (169 `computed` settlements since 2026-06-07) but outcomes lived only in `settlement_records.payload` JSON, never in the queryable evidence table. This made CLV mathematically incalculable for certification queries (0 true CLV-path picks out of 221 evidence-settled).
