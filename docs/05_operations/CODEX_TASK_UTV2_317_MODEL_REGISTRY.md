# Codex Task Packet: UTV2-317 — MP-M2: Model Registry Foundation

**Status:** Ready for Codex dispatch  
**Tier:** T2  
**Linear:** UTV2-317  
**Merge deps:** None

---

## Why it matters

The Sports Modeling Program needs durable records of model versions and experiment runs.
Without this, model iteration is informal — no champion/challenger designation, no reproducibility,
no experiment history. This lays the DB foundation that MP-M3 through MP-M8 build on.

---

## Allowed files

- `supabase/migrations/202604030001_model_registry.sql` (new)
- `packages/db/src/schema.ts` (add enum arrays)
- `packages/db/src/database.types.ts` (add table type shapes — pragmatic: `pnpm supabase:types` cannot run in isolation; add manually matching the migration)
- `packages/db/src/types.ts` (add derived types)
- `packages/db/src/repositories.ts` (add interfaces, extend RepositoryBundle with optional fields)
- `packages/db/src/runtime-repositories.ts` (add InMemory + Database implementations)
- `packages/db/src/index.ts` (add to canonicalTables, export new types)
- `packages/db/src/model-registry.test.ts` (new test file)

## Forbidden files

All others. Do not touch `apps/`, `packages/contracts/`, `packages/domain/`, or any existing migration files.

---

## Migration SQL

File: `supabase/migrations/202604030001_model_registry.sql`

### model_registry table

```sql
-- model_registry: durable registry of model versions and their operational status
create table if not exists public.model_registry (
  id uuid primary key default gen_random_uuid(),
  model_name text not null,
  version text not null,
  sport text not null,
  market_family text not null,
  status text not null default 'staged',
  champion_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint model_registry_status_check check (
    status in ('champion', 'challenger', 'staged', 'archived')
  )
);

-- Enforce: only one champion per (sport, market_family)
create unique index model_registry_unique_champion_idx
  on public.model_registry(sport, market_family)
  where status = 'champion';

create index model_registry_sport_market_idx
  on public.model_registry(sport, market_family);
```

### experiment_ledger table

```sql
-- experiment_ledger: training/eval/backtest run history per model version
create table if not exists public.experiment_ledger (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.model_registry(id),
  run_type text not null,
  sport text not null,
  market_family text not null,
  status text not null default 'running',
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint experiment_ledger_run_type_check check (
    run_type in ('training', 'eval', 'backtest', 'calibration')
  ),
  constraint experiment_ledger_status_check check (
    status in ('running', 'completed', 'failed', 'cancelled')
  )
);

create index experiment_ledger_model_id_idx
  on public.experiment_ledger(model_id);
```

---

## schema.ts additions

Add to `packages/db/src/schema.ts`:

```typescript
export const modelStatuses = ['champion', 'challenger', 'staged', 'archived'] as const;
export const experimentRunTypes = ['training', 'eval', 'backtest', 'calibration'] as const;
export const experimentStatuses = ['running', 'completed', 'failed', 'cancelled'] as const;
```

---

## database.types.ts additions

Add `model_registry` and `experiment_ledger` to the `Tables` object in `packages/db/src/database.types.ts`.
Follow the exact `Row / Insert / Update` shape of existing tables. Key shapes:

**model_registry:**
```typescript
model_registry: {
  Row: {
    id: string
    model_name: string
    version: string
    sport: string
    market_family: string
    status: string
    champion_since: string | null
    metadata: Json
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    model_name: string
    version: string
    sport: string
    market_family: string
    status?: string
    champion_since?: string | null
    metadata?: Json
    created_at?: string
    updated_at?: string
  }
  Update: {
    id?: string
    model_name?: string
    version?: string
    sport?: string
    market_family?: string
    status?: string
    champion_since?: string | null
    metadata?: Json
    created_at?: string
    updated_at?: string
  }
  Relationships: []
}
```

**experiment_ledger:**
```typescript
experiment_ledger: {
  Row: {
    id: string
    model_id: string
    run_type: string
    sport: string
    market_family: string
    status: string
    started_at: string
    finished_at: string | null
    metrics: Json
    notes: string | null
    created_at: string
  }
  Insert: {
    id?: string
    model_id: string
    run_type: string
    sport: string
    market_family: string
    status?: string
    started_at?: string
    finished_at?: string | null
    metrics?: Json
    notes?: string | null
    created_at?: string
  }
  Update: {
    id?: string
    model_id?: string
    run_type?: string
    sport?: string
    market_family?: string
    status?: string
    started_at?: string
    finished_at?: string | null
    metrics?: Json
    notes?: string | null
    created_at?: string
  }
  Relationships: [
    {
      foreignKeyName: "experiment_ledger_model_id_fkey"
      columns: ["model_id"]
      isOneToOne: false
      referencedRelation: "model_registry"
      referencedColumns: ["id"]
    }
  ]
}
```

---

## types.ts additions

Add to `packages/db/src/types.ts` (import the new schema enums at the top alongside existing imports):

```typescript
import { modelStatuses, experimentRunTypes, experimentStatuses } from './schema.js';

export type ModelStatus = (typeof modelStatuses)[number];
export type ExperimentRunType = (typeof experimentRunTypes)[number];
export type ExperimentStatus = (typeof experimentStatuses)[number];
export type ModelRegistryRow = Tables<'model_registry'>;
export type ExperimentLedgerRow = Tables<'experiment_ledger'>;
// Record aliases (for consistency with rest of codebase)
export type ModelRegistryRecord = ModelRegistryRow;
export type ExperimentLedgerRecord = ExperimentLedgerRow;
```

---

## Repository interfaces (repositories.ts)

Add to `packages/db/src/repositories.ts`:

```typescript
export interface ModelRegistryCreateInput {
  modelName: string;
  version: string;
  sport: string;
  marketFamily: string;
  status?: ModelStatus;
  metadata?: Record<string, unknown>;
}

export interface ModelRegistryRepository {
  create(input: ModelRegistryCreateInput): Promise<ModelRegistryRecord>;
  findById(id: string): Promise<ModelRegistryRecord | null>;
  findChampion(sport: string, marketFamily: string): Promise<ModelRegistryRecord | null>;
  listBySport(sport: string): Promise<ModelRegistryRecord[]>;
  updateStatus(id: string, status: ModelStatus, championSince?: string): Promise<ModelRegistryRecord>;
}

export interface ExperimentLedgerCreateInput {
  modelId: string;
  runType: ExperimentRunType;
  sport: string;
  marketFamily: string;
  notes?: string;
}

export interface ExperimentLedgerRepository {
  create(input: ExperimentLedgerCreateInput): Promise<ExperimentLedgerRecord>;
  findById(id: string): Promise<ExperimentLedgerRecord | null>;
  listByModelId(modelId: string): Promise<ExperimentLedgerRecord[]>;
  complete(id: string, metrics: Record<string, unknown>): Promise<ExperimentLedgerRecord>;
  fail(id: string, notes?: string): Promise<ExperimentLedgerRecord>;
}
```

Extend `RepositoryBundle` with **optional** fields:

```typescript
// In RepositoryBundle, add:
modelRegistry?: ModelRegistryRepository;
experimentLedger?: ExperimentLedgerRepository;
```

---

## runtime-repositories.ts

Add four classes following existing InMemory and Database patterns:

- `InMemoryModelRegistryRepository` — Map-based storage
- `InMemoryExperimentLedgerRepository` — Map-based storage
- `DatabaseModelRegistryRepository` — Supabase `.from('model_registry')` calls
- `DatabaseExperimentLedgerRepository` — Supabase `.from('experiment_ledger')` calls

Add a factory function:

```typescript
export function createModelRegistryRepositories(
  client?: SupabaseClient
): { modelRegistry: ModelRegistryRepository; experimentLedger: ExperimentLedgerRepository }
```

Returns InMemory implementations when no client provided, Database implementations when client present.

---

## index.ts additions

- Add `'model_registry'` and `'experiment_ledger'` to the `canonicalTables` array
- Export all new types: `ModelStatus`, `ExperimentRunType`, `ExperimentStatus`, `ModelRegistryRecord`, `ExperimentLedgerRecord`
- Export `ModelRegistryRepository`, `ExperimentLedgerRepository` interfaces
- Export new InMemory + Database classes

---

## Tests (model-registry.test.ts)

Test runner: `node:test` + `tsx --test` + `node:assert/strict`. **NO Jest/Vitest.**

Required test cases (minimum 8):
1. `create()` returns a record with correct fields and status='staged'
2. `findChampion()` returns null when no champion exists for a sport/market pair
3. `updateStatus(id, 'champion')` sets status and champion_since
4. `findChampion()` returns the model after promoting to champion
5. Promoting second model to champion for same sport/market: InMemory replaces, old model archived (or both queries for same slot — confirm behavior via test)
6. `ExperimentLedgerRepository.create()` creates a running experiment linked to model
7. `complete()` sets status='completed' and stores metrics
8. `fail()` sets status='failed'
9. `listByModelId()` returns all experiments for a model

---

## Acceptance criteria

- Migration SQL file exists and is syntactically valid
- `model_registry` and `experiment_ledger` types in `database.types.ts`
- `ModelRegistryRecord` and `ExperimentLedgerRecord` exported from `packages/db`
- Repository interfaces defined with correct method signatures
- InMemory + Database implementations exist for both
- `RepositoryBundle` extended with optional `modelRegistry?` and `experimentLedger?`
- Unit tests pass: minimum 8 test cases
- `pnpm verify` green

## Verification

```
pnpm test
pnpm type-check
```

## Rollback note

If migration applied to production and rollback needed: `drop table experiment_ledger; drop table model_registry;` — no existing tables reference these new tables.

---

## Rules

- No opportunistic refactors
- No changes to existing repository interfaces or implementations
- No API routes — this is DB + repo layer only
- Stop and report if scope is ambiguous or collides with active work
