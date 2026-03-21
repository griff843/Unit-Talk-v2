# Week 14 — Verification Control Plane Salvage

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-21 |
| Last Updated | 2026-03-21 |

---

## Objective

Selectively salvage the foundational verification control plane modules from `unit-talk-production` into `unit-talk-v2` as a new `packages/verification` package. Adapt all salvaged code to V2's domain model, lifecycle states, repository pattern, and test conventions.

This is **selective salvage under V2 contracts** — not wholesale porting. Every salvaged module must compile against V2 types, use V2 lifecycle states, and pass V2's `pnpm verify` gate. No old-system runtime dependencies are carried forward.

---

## Relationship to Prior Weeks

**Weeks 1-13** built the canonical runtime: submission, promotion, distribution, settlement, and operator visibility — all live, 87/87 tests passing.

**Week 14** introduces the first non-runtime subsystem: a verification backbone that can track, replay, and query structured test/verification runs. This is the foundation for future replay canaries, regression detection, and model comparison — but Week 14 delivers only the scaffolding, not those capabilities.

**Source material**: `C:\dev\unit-talk-production\apps\api\src\lib\verification\` — scenarios, run-history, archive, and CLI query surface. The observation hub, lab, promotion, shadow, fault, and strategy modules are explicitly excluded from Week 14.

---

## Pre-Implementation Baseline

| Check | Required state |
|---|---|
| `pnpm test` | 87/87 |
| `pnpm test:db` | 1/1 |
| `pnpm verify` | clean (lint + type-check + build + test) |
| No existing `packages/verification` directory | confirmed |
| Old verification control plane available for reference | `C:\dev\unit-talk-production\apps\api\src\lib\verification\` |

---

## Scope

### Slice 1 — Package Scaffold

**The gap**: V2 has no verification package. No scenario definitions, no run tracking, no verification query surface.

**Deliverables**:

- Create `packages/verification/` with `package.json`, `tsconfig.json`, `src/index.ts`
- Add `packages/verification` to root `tsconfig.json` references
- Add `@unit-talk/verification` to pnpm workspace
- Package must build independently via `pnpm exec tsc -b packages/verification/tsconfig.json`
- Package may import from `@unit-talk/contracts` and `@unit-talk/config` only (no `@unit-talk/db` dependency in Week 14)

### Slice 2 — Scenario Registry

**Source**: `unit-talk-production/apps/api/src/lib/verification/scenarios/`

**Deliverables**:

- `packages/verification/src/scenarios/types.ts` — `ScenarioDefinition`, `ScenarioMode` (`'replay' | 'runtime' | 'hybrid'`), `VerificationStage`
- `packages/verification/src/scenarios/definitions.ts` — ≥5 V2-native scenarios adapted to V2 lifecycle
- `packages/verification/src/scenarios/registry.ts` — `ScenarioRegistry` class + `DEFAULT_REGISTRY` singleton
- `packages/verification/src/scenarios/index.ts` — public exports

**Adaptation required**:

Old lifecycle stages (`PICK_SUBMITTED`, `PICK_GRADED`, `PICK_POSTED`, `PICK_SETTLED`, `RECAP_TRIGGERED`) must be replaced with V2 stages. The 5 V2-native scenarios are:

| ID | Name | V2 Lifecycle Stages |
|---|---|---|
| `submission-validation` | Submission and Validation | `validated` |
| `promotion-routing` | Promotion Evaluation and Routing | `validated → queued` |
| `distribution-delivery` | Distribution and Delivery | `queued → posted` |
| `settlement-resolution` | Settlement and Correction | `posted → settled` |
| `full-lifecycle` | Full Lifecycle End-to-End | `validated → queued → posted → settled` |

Each scenario definition includes: `id`, `name`, `mode`, `fixturePath` (optional), `lifecycleStagesExpected`, `expectedAssertions` (human-readable), `tags`.

**Tests** (≥4):
1. All 5 built-in scenarios are registered in DEFAULT_REGISTRY
2. `registry.get(id)` returns correct scenario
3. `registry.getByMode('replay')` filters correctly
4. `registry.getByTag(tag)` filters correctly

### Slice 3 — Run History (RunStore + QueryRunner)

**Source**: `unit-talk-production/apps/api/src/lib/verification/run-history/`

**Deliverables**:

- `packages/verification/src/run-history/types.ts` — `UnifiedRunRecord`, `RunIndex`, `RunVerdict`, `RunMode`, `RunSummary`
- `packages/verification/src/run-history/run-store.ts` — `RunStore` class (JSONL append-only + JSON index)
- `packages/verification/src/run-history/query.ts` — `QueryRunner` class (recent, failures, summary, byScenario)
- `packages/verification/src/run-history/index.ts` — public exports

**Adaptation required**:

`UnifiedRunRecord` core fields preserved: `runId`, `scenarioId`, `mode`, `commitHash`, `startedAt`, `completedAt`, `durationMs`, `verdict`, `artifactPath`, `metadata`.

Old-system-specific fields (`gateH`, `archiveSourceId`, `replayRegistryId`, `experimentId`, `strategyId`, `determinismHash`) become optional or are removed. They may be re-added in future weeks when the corresponding modules are ported.

**Persistence**:
```
out/verification/
├── runs.jsonl          — UnifiedRunRecord[] (append-only, one per line)
├── run-index.json      — RunIndex snapshot (overwritten atomically)
└── watch-events.jsonl  — reserved for future use
```

`out/verification/` must be gitignored.

**Tests** (≥4):
1. `appendRun` writes a valid JSONL line and updates the index
2. `getRecentRuns(limit)` returns correct number of records in reverse chronological order
3. `getFailedRuns()` returns only FAIL/ERROR verdict records
4. `RunIndex.byScenario` tallies pass/fail counts correctly

### Slice 4 — Archive Registry

**Source**: `unit-talk-production/apps/api/src/lib/verification/archive/`

**Deliverables**:

- `packages/verification/src/archive/types.ts` — `ArchiveSource`, `ReplayRegistryEntry`, `ArchiveSourceType`, `ReplayPurpose`
- `packages/verification/src/archive/sources.ts` — ≥2 V2-native archive sources
- `packages/verification/src/archive/replay-packs.ts` — ≥2 replay registry entries linking sources to scenarios
- `packages/verification/src/archive/registry.ts` — `ArchiveRegistry` class + `DEFAULT_ARCHIVE_REGISTRY` singleton
- `packages/verification/src/archive/index.ts` — public exports

**Adaptation required**:

Old archive sources referenced old fixture files and old event formats. V2 archive sources must reference V2-format fixture files (created in Slice 5). The `ArchiveSourceType` enum (`'fixture' | 'journal' | 'snapshot-bundle' | 'historical-run-pack'`) is portable as-is.

**Tests** (≥3):
1. All built-in archive sources are registered
2. All replay packs link to valid archive sources and valid scenarios
3. `getFixturePath()` resolves correctly relative to repo root

### Slice 5 — Test Fixtures

**Deliverables**:

- `packages/verification/test-fixtures/` directory
- ≥2 V2-native JSONL fixture files containing events in V2 domain format
- Fixture files must be deterministically replayable (stable IDs, stable timestamps)

Suggested fixtures:

| File | Content | Purpose |
|---|---|---|
| `v2-lifecycle-events.jsonl` | Full lifecycle events (submission → settlement) using V2 types | Full-lifecycle and settlement scenarios |
| `v2-promotion-events.jsonl` | Submission events with promotion metadata for both best-bets and trader-insights | Promotion and distribution scenarios |

Fixture format: one JSON object per line, each representing a V2 domain event with `type`, `timestamp`, `payload` fields.

### Slice 6 — CLI Query Surface

**Deliverables**:

- `apps/api/src/scripts/query-runs.ts` — CLI tool that reads from RunStore and prints formatted output
- Add to `apps/api/package.json`:
  ```json
  "runs:recent": "tsx src/scripts/query-runs.ts --recent",
  "runs:failures": "tsx src/scripts/query-runs.ts --failures",
  "runs:summary": "tsx src/scripts/query-runs.ts --summary"
  ```

**Output**: formatted tables to stdout. No UI. No server dependency.

---

## Close Criteria

| Criterion | Evidence |
|---|---|
| `packages/verification` exists and builds | `pnpm exec tsc -b packages/verification/tsconfig.json` clean |
| Package added to root tsconfig references | Root `tsconfig.json` includes `packages/verification` |
| Scenario registry has 5 V2-native scenarios | Code read + test |
| RunStore writes JSONL and updates index | Test |
| QueryRunner returns recent/failures/summary | Test |
| Archive registry has ≥2 sources and ≥2 replay packs | Code read + test |
| ≥2 V2-native fixture files exist | File listing |
| CLI query surface works (`pnpm runs:recent`) | Manual verification |
| No regression in existing 87 tests | `pnpm test` output |
| `pnpm test` ≥ 99 (87 + ≥12 new) | `pnpm test` output |
| `pnpm test:db` 1/1 | `pnpm test:db` output |
| `pnpm verify` clean (lint + type-check + build + test) | `pnpm verify` output |
| No runtime imports from unit-talk-production | Code audit |
| No writes to production tables | Code audit |
| All lifecycle stages use V2 names (validated/queued/posted/settled) | Code audit |
| `out/verification/` is gitignored | `.gitignore` check |

---

## Non-Goals

The following are explicitly out of scope for Week 14:

- **Observation Hub** — too coupled to old runtime health endpoints, SLO functions, and production DB queries. Requires separate adaptation sprint.
- **Lab / Backtest module** — strategy evaluation is premature until scenario + run-history foundation is proven.
- **Promotion / Trust Scoring module** — readiness decisions are premature until lab module exists.
- **Shadow Divergence module** — no shadow mode infrastructure in V2 yet.
- **Fault Injection framework** — no fault injection targets in V2 yet.
- **Strategy Simulation module** — depends on lab module.
- **Old execution mode adapters** — bridge code for old event formats not needed.
- **Old migrations** — V2 has its own migration chain.
- **Old Smart Form logic** — V2 smart-form is already independent.
- **Old BaseAgent framework** — V2 does not use agent-based architecture.
- **Old observability package** — V2 has its own observability package.
- **Old command center imports** — V2 operator-web is independent.
- **Agent/pipeline/scoring expansion** — no new agents, no scoring algorithms, no pipeline changes.
- **Runtime code changes** — Week 14 adds a new package only; no changes to existing apps/api, apps/worker, apps/operator-web, or apps/smart-form code (except adding test files to the test command and CLI scripts).
- **New routes or endpoints** — no HTTP surface changes.
- **Schema migrations** — no database changes.
- **Live routing changes** — no changes to discord:canary, discord:best-bets, or discord:trader-insights.

---

## Rollback / Failure Conditions

Halt Week 14 and do not continue if:

- Any pre-Week-14 test regresses (87 existing tests)
- `pnpm test:db` fails
- `packages/verification` cannot build independently
- Type-check or lint failures introduced in existing packages
- Any import from `unit-talk-production` appears in V2 runtime code

When triggered:
- Remove `packages/verification` directory
- Remove root tsconfig reference
- Confirm `pnpm test` returns to 87/87 and `pnpm test:db` passing
- Record in `docs/06_status/week_14_failure_rollback_template.md`

---

## Affected Surfaces

| File/Directory | Change |
|---|---|
| `packages/verification/` (new) | New package: scenarios, run-history, archive, test-fixtures |
| `packages/verification/package.json` (new) | Package manifest |
| `packages/verification/tsconfig.json` (new) | TypeScript config |
| `packages/verification/src/**/*.ts` (new) | All module source files |
| `packages/verification/src/**/*.test.ts` (new) | All module tests |
| `packages/verification/test-fixtures/*.jsonl` (new) | V2-native fixture files |
| `tsconfig.json` (modify) | Add `packages/verification` reference |
| `pnpm-workspace.yaml` (modify, if needed) | Ensure `packages/*` glob covers new package |
| `.gitignore` (modify) | Add `out/verification/` |
| `apps/api/src/scripts/query-runs.ts` (new) | CLI query surface |
| `apps/api/package.json` (modify) | Add `runs:recent`, `runs:failures`, `runs:summary` scripts |
| Root `package.json` (modify) | Update `pnpm test` command to include verification test files |

No other files require changes.

---

## Salvage Reference Map

| V2 Module | Old Source Path | Adaptation |
|---|---|---|
| `scenarios/types.ts` | `verification/scenarios/types.ts` | Replace old lifecycle stages with V2 stages; remove watch condition linking |
| `scenarios/definitions.ts` | `verification/scenarios/definitions.ts` | 5 new V2-native scenarios replacing 5 old scenarios |
| `scenarios/registry.ts` | `verification/scenarios/registry.ts` | Port class structure; adapt method signatures to V2 types |
| `run-history/types.ts` | `verification/run-history/types.ts` | Keep core fields; make old-specific fields optional or remove |
| `run-history/run-store.ts` | `verification/run-history/run-store.ts` | Port JSONL + index pattern; adapt paths to `out/verification/` |
| `run-history/query.ts` | `verification/run-history/query.ts` | Port QueryRunner; adapt to V2 UnifiedRunRecord |
| `archive/types.ts` | `verification/archive/types.ts` | Port type hierarchy; keep ArchiveSourceType and ReplayPurpose |
| `archive/sources.ts` | `verification/archive/sources.ts` | New V2-native sources replacing old AS1-AS5 |
| `archive/replay-packs.ts` | `verification/archive/replay-packs.ts` | New V2-native packs linking to V2 sources and scenarios |
| `archive/registry.ts` | `verification/archive/registry.ts` | Port class structure; adapt to V2 sources |
| `scripts/query-runs.ts` | `scripts/query-runs.ts` | Port CLI; adapt to V2 RunStore and output format |

---

## Artifacts

| Purpose | File |
|---|---|
| Contract (this file) | `docs/05_operations/week_14_verification_control_plane_salvage_contract.md` |
| Proof template | `docs/06_status/week_14_proof_template.md` |
| Failure / rollback template | `docs/06_status/week_14_failure_rollback_template.md` |

---

## Authority Links

| Purpose | File |
|---|---|
| Settlement architectural contract | `docs/02_architecture/contracts/settlement_contract.md` |
| Pick lifecycle contract | `docs/02_architecture/contracts/pick_lifecycle_contract.md` |
| Distribution contract | `docs/02_architecture/contracts/distribution_contract.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
| Week 13 contract (predecessor) | `docs/05_operations/week_13_operator_trader_insights_health_contract.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Old verification control plane (reference only) | `C:\dev\unit-talk-production\apps\api\src\lib\verification\` |
