# Codex Task Packet: UTV2-318 + UTV2-319 — MP-M2: Model Ops Foundation (Drift Monitoring + Execution Quality)

**Status:** Ready for Codex dispatch  
**Tier:** T2  
**Linear:** UTV2-318 + UTV2-319  
**Merge deps:** UTV2-317 (merged — model_registry + experiment_ledger already in main)

---

## Why it matters

UTV2-317 built the model registry. These two issues add the operational layer on top:
- **UTV2-318**: periodic health snapshots that flag when a model's live performance drifts from its baseline
- **UTV2-319**: measures how well we actually capture edge at the sportsbook layer (entry line vs closing line, by provider and market family)

Both are packages/db layer only. No API routes. No app-level changes.

---

## Allowed files

- `supabase/migrations/202604030002_model_health_snapshots.sql` (new)
- `packages/db/src/schema.ts` (add alertLevels enum array)
- `packages/db/src/database.types.ts` (add model_health_snapshots type shapes — manual, same pragmatic pattern as UTV2-317)
- `packages/db/src/types.ts` (add derived types)
- `packages/db/src/repositories.ts` (add interfaces, extend RepositoryBundle)
- `packages/db/src/runtime-repositories.ts` (add InMemory + Database implementations)
- `packages/db/src/index.ts` (add to canonicalTables, export new types)
- `packages/db/src/model-health-snapshot.test.ts` (new)
- `packages/db/src/execution-quality.test.ts` (new)

## Forbidden files

All others. Do not touch `apps/`, `packages/contracts/`, `packages/domain/`, or any existing migration files.

---

## Part A: UTV2-318 — Drift Monitoring (model_health_snapshots)

### Migration SQL

File: `supabase/migrations/202604030002_model_health_snapshots.sql`

```sql
-- model_health_snapshots: periodic snapshots of live model performance for drift detection
create table if not exists public.model_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.model_registry(id),
  sport text not null,
  market_family text not null,
  snapshot_at timestamptz not null default timezone('utc', now()),
  win_rate numeric,
  roi numeric,
  sample_size int not null default 0,
  drift_score numeric,
  calibration_score numeric,
  alert_level text not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint model_health_snapshots_alert_level_check check (
    alert_level in ('none', 'warning', 'critical')
  )
);

create index model_health_snapshots_model_id_idx
  on public.model_health_snapshots(model_id);

create index model_health_snapshots_sport_market_idx
  on public.model_health_snapshots(sport, market_family);

-- Partial index: quickly find models needing attention
create index model_health_snapshots_alert_active_idx
  on public.model_health_snapshots(alert_level, snapshot_at)
  where alert_level != 'none';
```

### schema.ts addition

```typescript
export const alertLevels = ['none', 'warning', 'critical'] as const;
```

### database.types.ts addition

Add `model_health_snapshots` to the `Tables` object following the Row/Insert/Update pattern:

```typescript
model_health_snapshots: {
  Row: {
    id: string
    model_id: string
    sport: string
    market_family: string
    snapshot_at: string
    win_rate: number | null
    roi: number | null
    sample_size: number
    drift_score: number | null
    calibration_score: number | null
    alert_level: string
    metadata: Json
    created_at: string
  }
  Insert: {
    id?: string
    model_id: string
    sport: string
    market_family: string
    snapshot_at?: string
    win_rate?: number | null
    roi?: number | null
    sample_size?: number
    drift_score?: number | null
    calibration_score?: number | null
    alert_level?: string
    metadata?: Json
    created_at?: string
  }
  Update: {
    id?: string
    model_id?: string
    sport?: string
    market_family?: string
    snapshot_at?: string
    win_rate?: number | null
    roi?: number | null
    sample_size?: number
    drift_score?: number | null
    calibration_score?: number | null
    alert_level?: string
    metadata?: Json
    created_at?: string
  }
  Relationships: [
    {
      foreignKeyName: "model_health_snapshots_model_id_fkey"
      columns: ["model_id"]
      isOneToOne: false
      referencedRelation: "model_registry"
      referencedColumns: ["id"]
    }
  ]
}
```

### types.ts additions

```typescript
import { alertLevels } from './schema.js';

export type AlertLevel = (typeof alertLevels)[number];
export type ModelHealthSnapshotRow = Tables<'model_health_snapshots'>;
export type ModelHealthSnapshotRecord = ModelHealthSnapshotRow;
```

### Repository interface (repositories.ts)

```typescript
export interface ModelHealthSnapshotCreateInput {
  modelId: string;
  sport: string;
  marketFamily: string;
  winRate?: number;
  roi?: number;
  sampleSize?: number;
  driftScore?: number;
  calibrationScore?: number;
  alertLevel?: AlertLevel;
  metadata?: Record<string, unknown>;
}

export interface ModelHealthSnapshotRepository {
  create(input: ModelHealthSnapshotCreateInput): Promise<ModelHealthSnapshotRecord>;
  findLatestByModel(modelId: string): Promise<ModelHealthSnapshotRecord | null>;
  listByModel(modelId: string, limit?: number): Promise<ModelHealthSnapshotRecord[]>;
  listAlerted(level?: AlertLevel): Promise<ModelHealthSnapshotRecord[]>;
}
```

Extend `RepositoryBundle` with optional field:
```typescript
modelHealthSnapshots?: ModelHealthSnapshotRepository;
```

### Implementations (runtime-repositories.ts)

**InMemoryModelHealthSnapshotRepository**: Map-based. `create` generates a UUID, stores in Map. `findLatestByModel` returns the snapshot with most recent `snapshot_at`. `listByModel` returns all for model sorted descending by `snapshot_at`, respects `limit`. `listAlerted` filters by `alert_level` (if level provided: exact match, else all non-'none').

**DatabaseModelHealthSnapshotRepository**: Supabase `.from('model_health_snapshots')` calls matching the interface. For `findLatestByModel`: `.select('*').eq('model_id', modelId).order('snapshot_at', { ascending: false }).limit(1)`. For `listByModel`: `.select('*').eq('model_id', modelId).order('snapshot_at', { ascending: false })` + optional `.limit(limit)`. For `listAlerted`: if level provided `.eq('alert_level', level)` else `.neq('alert_level', 'none')`.

Add to `createModelRegistryRepositories` factory (or create a new `createModelOpsRepositories` factory):

```typescript
export function createModelOpsRepositories(
  client?: SupabaseClient
): {
  modelRegistry: ModelRegistryRepository;
  experimentLedger: ExperimentLedgerRepository;
  modelHealthSnapshots: ModelHealthSnapshotRepository;
}
```

Returns InMemory when no client, Database when client present.

### index.ts additions

- Add `'model_health_snapshots'` to `canonicalTables`
- Export `AlertLevel`, `ModelHealthSnapshotRecord`
- Export `ModelHealthSnapshotRepository` interface
- Export `InMemoryModelHealthSnapshotRepository`, `DatabaseModelHealthSnapshotRepository`
- Export `createModelOpsRepositories`

### Tests (model-health-snapshot.test.ts)

Test runner: `node:test` + `tsx --test` + `node:assert/strict`. NO Jest/Vitest.

Required test cases (minimum 6):
1. `create()` returns a record with correct fields and `alert_level='none'` by default
2. `findLatestByModel()` returns null when no snapshots exist for the model
3. `findLatestByModel()` returns the most recent snapshot (not by insertion order, by `snapshot_at`)
4. `listByModel()` returns all snapshots sorted descending by `snapshot_at`
5. `listAlerted()` with no arg returns only non-'none' records
6. `listAlerted('critical')` returns only critical records

---

## Part B: UTV2-319 — Sportsbook Execution Quality

This is analytics-only — no new DB table. It reads from existing `provider_offers` and `settlement_records` tables. The goal is to quantify per-provider execution quality (line capture) for routing and urgency decisions.

### types.ts additions

```typescript
export type ExecutionQualityReport = {
  providerKey: string;
  sportKey: string | null;
  marketFamily: string;
  sampleSize: number;
  avgEntryLine: number | null;
  avgClosingLine: number | null;
  avgLineDelta: number | null; // avgEntryLine - avgClosingLine (positive = captured value)
  winRate: number | null;
  roi: number | null;
};
```

No DB table — this is a derived/aggregated type only.

### Repository interface (repositories.ts)

```typescript
export interface ExecutionQualityRepository {
  /**
   * Aggregate execution quality by provider.
   * @param sport Optional filter by sport_key.
   */
  summarizeByProvider(sport?: string): Promise<ExecutionQualityReport[]>;
  /**
   * Breakdown by market family for a specific provider.
   */
  summarizeByMarketFamily(providerKey: string): Promise<ExecutionQualityReport[]>;
}
```

Extend `RepositoryBundle` with optional field:
```typescript
executionQuality?: ExecutionQualityRepository;
```

### Implementations (runtime-repositories.ts)

**InMemoryExecutionQualityRepository**:
- Constructor accepts seed data: `seedReports?: ExecutionQualityReport[]`
- `summarizeByProvider(sport?)`: returns seeded reports filtered by sport if provided, else all
- `summarizeByMarketFamily(providerKey)`: returns seeded reports filtered by providerKey

**DatabaseExecutionQualityRepository**:
- Constructor accepts `SupabaseClient`
- `summarizeByProvider(sport?)`:
  1. Query `provider_offers`: `.select('provider_key, sport_key, provider_market_key, line, is_closing')` + filter by `sport_key` if provided
  2. Group results in-process by `provider_key` + `sport_key` + `provider_market_key`
  3. For each group: compute `avgEntryLine` (from `is_closing=false` rows), `avgClosingLine` (from `is_closing=true` rows), `avgLineDelta`, `sampleSize`
  4. Also query `settlement_records`: `.select('pick_id, result, status').eq('status', 'settled')` (limit 1000 for now)
  5. Compute `winRate` and `roi` from settlement_records where result is 'win' or 'loss'
  6. Note: win/loss correlation to provider_key requires matching via pick metadata — for v1, return `winRate: null, roi: null` from DB impl (settlement correlation is follow-on work); focus on line capture metrics
- `summarizeByMarketFamily(providerKey)`:
  1. Same approach but filtered by `providerKey`, grouped by `provider_market_key`

**Important**: The win/loss correlation to specific provider is left as null in the initial DB implementation since it requires joining through picks. That's acceptable for this slice — the line capture delta metric is the primary value.

### index.ts additions

- Export `ExecutionQualityReport` type
- Export `ExecutionQualityRepository` interface
- Export `InMemoryExecutionQualityRepository`, `DatabaseExecutionQualityRepository`

### Tests (execution-quality.test.ts)

Test runner: `node:test` + `tsx --test` + `node:assert/strict`. NO Jest/Vitest.

Required test cases (minimum 5):
1. InMemory `summarizeByProvider()` returns empty array when no seed data
2. InMemory `summarizeByProvider()` returns all reports when no sport filter
3. InMemory `summarizeByProvider('NFL')` filters by sport
4. InMemory `summarizeByMarketFamily('draftkings')` returns only draftkings reports
5. `avgLineDelta` computed correctly (test seed data with known entry and closing lines)

---

## Acceptance criteria

- Migration `202604030002_model_health_snapshots.sql` is syntactically valid
- `model_health_snapshots` types in `database.types.ts`
- `ModelHealthSnapshotRecord` and `ExecutionQualityReport` exported from `packages/db`
- `ModelHealthSnapshotRepository` and `ExecutionQualityRepository` interfaces defined
- InMemory + Database implementations exist for both
- `RepositoryBundle` extended with optional `modelHealthSnapshots?` and `executionQuality?`
- `model_health_snapshots` in `canonicalTables`
- Unit tests pass: minimum 6 (snapshot) + 5 (quality) = 11 total
- `pnpm verify` green

## Verification

```
pnpm test
pnpm type-check
```

## Rollback note

If migration applied to production and rollback needed: `drop table model_health_snapshots;` — only model_registry references it (FK) which was added in prior migration.

---

## Rules

- No opportunistic refactors
- No changes to existing repository interfaces or implementations
- No API routes — this is DB + repo layer only
- No new packages — add to `packages/db` only
- Stop and report if scope is ambiguous or collides with active work
