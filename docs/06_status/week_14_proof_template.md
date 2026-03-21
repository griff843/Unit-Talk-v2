# Week 14 Proof Template

## Metadata

| Field | Value |
|---|---|
| Week | 14 — Verification Control Plane Salvage |
| Template status | **Completed — independently verified 2026-03-21** |
| Authority | `docs/05_operations/week_14_verification_control_plane_salvage_contract.md` |

---

## Pre-Implementation Gate

Before beginning Week 14 implementation, confirm:

| Check | Required | Result |
|---|---|---|
| `pnpm test` | 87/87 | **87/87 PASS** |
| `pnpm test:db` | 1/1 | **1/1 PASS** |
| `pnpm verify` | clean | **clean** |
| No existing `packages/verification` | confirmed | **confirmed** |

---

## Implementation Verification

### Slice 1 — Package Scaffold

| Check | Expected | Result |
|---|---|---|
| `packages/verification/package.json` exists | present | **present** — depends only on `@unit-talk/contracts` |
| `packages/verification/tsconfig.json` exists | present | **present** — composite build, extends base |
| `packages/verification/src/index.ts` exists with public exports | present | **present** — re-exports archive, run-history, scenarios |
| Root `tsconfig.json` references `packages/verification` | present | **present** — line 11 |
| `pnpm exec tsc -b packages/verification/tsconfig.json` builds clean | clean | **clean** — `pnpm build` passes |
| `@unit-talk/verification` importable from other packages | confirmed | **confirmed** — `query-runs.ts` imports it successfully |

### Slice 2 — Scenario Registry

| Check | Expected | Result |
|---|---|---|
| `ScenarioDefinition` type uses V2 lifecycle stages | no old stages | **confirmed** — `VerificationStage = 'validated' \| 'queued' \| 'posted' \| 'settled'` |
| `DEFAULT_REGISTRY` has 5 built-in scenarios | 5 registered | **5 registered** — test asserts `getAll().length === 5` |
| Scenario `submission-validation` defined | present | **present** — replay, stages: [validated] |
| Scenario `promotion-routing` defined | present | **present** — replay, stages: [validated, queued] |
| Scenario `distribution-delivery` defined | present | **present** — hybrid, stages: [queued, posted] |
| Scenario `settlement-resolution` defined | present | **present** — replay, stages: [posted, settled] |
| Scenario `full-lifecycle` defined | present | **present** — hybrid, stages: [validated, queued, posted, settled] |
| `registry.get(id)` works | test passes | **PASS** |
| `registry.getByMode()` works | test passes | **PASS** — getByMode('replay') returns 3 |
| `registry.getByTag()` works | test passes | **PASS** — getByTag('settlement') returns 1 |

### Slice 3 — Run History

| Check | Expected | Result |
|---|---|---|
| `UnifiedRunRecord` type defined with V2 core fields | present | **present** — runId, scenarioId, mode, commitHash, verdict, stageResults, etc. No old gateH/determinismHash/watchConditionsFired |
| `RunStore.appendRun()` writes JSONL line | test passes | **PASS** |
| `RunStore` updates `run-index.json` atomically | test passes | **PASS** — write to .tmp then rename |
| `RunStore.getRecentRuns(limit)` returns correct records | test passes | **PASS** — newest-first, respects limit |
| `RunStore.getFailedRuns()` filters by verdict | test passes | **PASS** — returns only FAIL/ERROR |
| `QueryRunner.summary()` returns pass/fail by scenario | test passes | **PASS** |
| Output directory is `out/verification/` | confirmed | **confirmed** — RunStore constructor joins outRoot + 'verification' |

### Slice 4 — Archive Registry

| Check | Expected | Result |
|---|---|---|
| `ArchiveSource` type defined | present | **present** |
| `ReplayRegistryEntry` type defined | present | **present** |
| ≥2 V2-native archive sources registered | ≥2 | **2** — v2-lifecycle-fixture, v2-promotion-fixture |
| ≥2 replay packs link to valid sources and scenarios | ≥2 | **2** — v2-full-lifecycle-pack, v2-promotion-routing-pack |
| `registry.getFixturePath()` resolves correctly | test passes | **PASS** — resolves under packages/verification/test-fixtures/ |

### Slice 5 — Test Fixtures

| Check | Expected | Result |
|---|---|---|
| `packages/verification/test-fixtures/` directory exists | present | **present** |
| ≥2 V2-native JSONL fixture files exist | ≥2 | **2** — v2-lifecycle-events.jsonl, v2-promotion-events.jsonl |
| Fixtures contain V2-format events (correct types) | confirmed | **confirmed** — submission.validated, promotion.queued, distribution.sent, settlement.recorded; lifecycleState uses V2 names |
| Fixtures are deterministically replayable (stable IDs) | confirmed | **confirmed** — stable UUIDs (e.g., pickId `1e40951c`, `a955039c`, `eb12a6c2`) |

### Slice 6 — CLI Query Surface

| Check | Expected | Result |
|---|---|---|
| `apps/api/src/scripts/query-runs.ts` exists | present | **present** — 134 lines, table formatting |
| `pnpm runs:recent` defined in package.json | present | **present** — apps/api/package.json line 13 |
| `pnpm runs:failures` defined in package.json | present | **present** — apps/api/package.json line 12 |
| `pnpm runs:summary` defined in package.json | present | **present** — apps/api/package.json line 14 |

CLI empty-store test:
- `--recent` with empty store: prints `(no runs found)` — **PASS**
- `--summary` with empty store: prints `(no run history)` — **PASS**

### Test gate

| Check | Required | Result |
|---|---|---|
| `pnpm test` | ≥99/99 (87 + ≥12 new) | **100/100 PASS** (87 + 13 new) |
| `pnpm test:db` | 1/1 | **1/1 PASS** |
| `pnpm lint` | clean | **clean** |
| `pnpm type-check` | clean | **clean** |
| `pnpm build` | clean | **clean** |

New test breakdown: 4 scenario + 4 run-store + 2 query + 3 archive = 13 new tests.

---

## Code Audit Verification

| Check | Expected | Result |
|---|---|---|
| No `import` from `unit-talk-production` paths at runtime | 0 imports | **0** — grep confirmed |
| No writes to production tables (`picks`, `distribution_outbox`, etc.) | 0 writes | **0** — verification package has no DB writes |
| All lifecycle stages use V2 names (`validated`/`queued`/`posted`/`settled`) | confirmed | **confirmed** — `VerificationStage` type, fixture events, scenario definitions |
| No old lifecycle stages (`PICK_SUBMITTED`/`PICK_GRADED`/etc.) | 0 references | **0** — grep confirmed |
| `out/verification/` in `.gitignore` | present | **present** — .gitignore line 13 |
| No changes to existing app runtime code | confirmed | **confirmed** — `@unit-talk/verification` imported only in `apps/api/src/scripts/query-runs.ts` (CLI script, not runtime route/service) |

Rejected modules not ported:
- `packages/verification/src/` contains only: `archive/`, `run-history/`, `scenarios/`, `index.ts`
- No observation, lab, promotion, shadow, fault, or strategy directories present

---

## Evidence to Record in `docs/06_status/system_snapshot.md`

- Package structure: 3 modules (scenarios, run-history, archive) + index.ts
- Scenario count: 5 V2-native scenarios
- RunStore verified: JSONL write + atomic JSON index rebuild
- Archive source count: 2 V2-native sources + 2 replay packs
- Fixture file count: 2 JSONL files (v2-lifecycle-events.jsonl, v2-promotion-events.jsonl)
- Final `pnpm test` count: 100/100
- Verification result: PASS

---

## Verdict

- [x] All pre-implementation gates: PASS
- [x] All slice checks: PASS
- [x] All test gate checks: PASS
- [x] Code audit clean
- [x] No regression in prior tests

**Verdict:** PASS

Independently verified 2026-03-21. Week 14 closed.
