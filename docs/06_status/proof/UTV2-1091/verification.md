# Proof Summary — UTV2-1091

**Issue:** INIT-1.2.1 — Isolated Full-Pipeline Replay Harness
**Tier:** T1
**Lane type:** verification
**SHA:** 8a35a9e410198821701d1de941ac21dbd90969a7 (branch HEAD at proof assembly)

## What Changed

`packages/verification/src/engine/replay-types.ts` — new type module defining: `ReplayStoreMode`, `PipelineStage`, `ReplayRun`, `ReplaySnapshot`, `StageReplayResult`. `ReplaySnapshot.data` is immutable (frozen at construction).

`packages/verification/src/engine/full-pipeline-replay.ts` — new `IsolatedReplayStore` and `FullPipelineReplayHarness` classes:

- **`IsolatedReplayStore`**: Constructor throws `ReplayProductionWriteError` if `mode='production'` — mechanical isolation guarantee at object construction. `writeProduction()` always throws and increments a trace counter regardless of mode.
- **`FullPipelineReplayHarness`**: Orchestrates staged replay across all four pipeline stages (ingestion → scoring → promotion → distribution). Each stage's snapshot data is frozen. Returns a `ReplayRun` with `production_write_count: 0` invariant on clean runs.
- **`ReplayProductionWriteError`**: Typed error class for production write rejection.

Dual mechanical write rejection: constructor guard prevents object creation with wrong mode; `writeProduction()` method always throws — no silent degradation path.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — env, lint, type-check, build, test, command checks all green |
| Replay harness tests | PASS — 9/9 adversarial tests (`packages/verification/src/engine/full-pipeline-replay.test.ts`) |
| pnpm test:db | PASS — 7/7 live-DB tests against Supabase zfzdnfwdarxucxtaojxm |
| R-level compliance | PASS (CI green) |
| Lane authority | PASS — lane_type: verification; packages/verification covered |

## Adversarial Tests

All 9 tests verify mechanical isolation guarantees:

- `IsolatedReplayStore` in `isolated` mode accepts writes — PASS
- `IsolatedReplayStore` constructor with `mode='production'` throws `ReplayProductionWriteError` — PASS
- `writeProduction()` always throws, regardless of mode — PASS (isolated mode also rejects)
- `writeProduction()` increments trace counter on each call — PASS
- `ReplaySnapshot.data` is frozen — mutation attempt throws in strict mode — PASS
- `FullPipelineReplayHarness.run()` returns `production_write_count: 0` on clean run — PASS
- `FullPipelineReplayHarness.run()` covers all four pipeline stages — PASS
- `FullPipelineReplayHarness.getProductionWriteCount()` delegates to store — PASS
- Failed stage results in `status: 'failed'` on returned `ReplayRun` — PASS

## pnpm test:db — Live DB

7/7 tests passed against Supabase project `zfzdnfwdarxucxtaojxm` (`apps/api/src/database-smoke.test.ts`):

- Submission and settlement persistence round-trip — PASS
- UTV2-920: invalid atomic enqueue → no lifecycle event or outbox row — PASS
- UTV2-920: invalid atomic delivery confirmation rollback — PASS
- UTV2-920: invalid atomic settlement → no rows written — PASS
- UTV2-883: no duplicate participants for same external_id and sport — PASS
- UTV2-996: re-settling creates correction row, not duplicate base — PASS
- UTV2-996: correction chain is additive, original row not mutated — PASS
