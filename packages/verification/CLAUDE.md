# Package: @unit-talk/verification

Shadow mode, deterministic replay, fault injection, and strategy evaluation control plane. The verification framework for proving system correctness.

## Role in Unit Talk V2

- System layer: **verification / simulation**
- Pure: mostly (adapters abstract I/O, core is computation)
- Maturity: rich (62 files, layered R1-R5 architecture), but low test coverage (4 test files)

## Role in Dependency Graph

**Imports:** `@unit-talk/contracts`

**Depended on by:** `apps/api` (imports verification types)

## What Lives Here

**Archive (replay pack registry):**
- `archive/` — `ReplayPackRegistry`, `ReplayPackSource` types

**Run History (execution logs):**
- `run-history/` — `RunStore`, `RunQuery` for querying past verification runs

**Scenarios (fault injection catalog):**
- `scenarios/` — `ScenarioRegistry`, `FaultScenario` definitions (F1-F5+)

**Engine (R1-R5 layers):**
- `engine/clock/` — `RealClockProvider`, `VirtualEventClock`
- `engine/adapters/` — Publish, Feed, Settlement, Recap, Notification adapters
- `engine/determinism-validator.ts` — deterministic replay verification
- `engine/event-store.ts` — `JournalEventStore` for event capture
- `engine/run-controller.ts` — `RunController` orchestration
- `engine/shadow/` — `ShadowRunner`, `ShadowComparator`, `DivergenceClassifier`, `ShadowVerdictEngine`, proof writer
- `engine/fault/` — `FaultInjector`, `FaultOrchestrator`, `AssertionEngine`, proof writer, scenario catalog (CORE_SUITE, FULL_SUITE)
- `engine/strategy/` — `StrategyProofWriter`

## Core Concepts

**R1 (Foundation):** Clock abstraction, adapter interfaces, run controller. Enables deterministic time and I/O isolation.

**R2 (Deterministic Replay):** Capture events during a run, replay them later, verify identical outputs. `DeterminismValidator` compares reference vs replay.

**R3 (Shadow Mode):** Run a parallel pipeline alongside production. `DivergenceClassifier` detects and categorizes differences (CRITICAL, WARNING, INFO). `ShadowVerdictEngine` produces pass/fail verdicts.

**R4 (Fault Injection):** Inject faults (network failures, DB errors, timeouts) during runs. `AssertionEngine` verifies system behavior under failure. Scenario catalog defines activation rules and expected outcomes.

**R5 (Strategy Evaluation):** Evaluate betting strategies against historical data, produce proof bundles.

## Tests

- `archive/registry.test.ts`
- `run-history/query.test.ts`
- `run-history/run-store.test.ts`
- `scenarios/registry.test.ts`

Gap: engine layer (shadow, fault, strategy) has no dedicated tests. Logic is complex (divergence classification, fault orchestration).

## Rules

- Adapters abstract all I/O — engine logic must not make direct HTTP/DB calls
- Shadow mode must never write to production tables
- Fault injection must be gated — never active in production without explicit activation

## What NOT to Do

- Do not run fault injection against production databases
- Do not add direct DB imports — use adapters
- Do not activate shadow mode without explicit configuration

## Known Drift or Cautions

- Type errors exist in `shadow-pipeline-runner.ts` and `divergence-classifier.ts` (pre-existing, not blocking)
- `shadow-runner.ts` has `exactOptionalPropertyTypes` issues with `from`/`to` date fields
- Low test coverage relative to complexity — engine assertions need expansion


---

## System Invariants (inherited from root CLAUDE.md)

**Test runner:** `node:test` + `tsx --test` + `node:assert/strict`. NOT Jest. NOT Vitest. NOT `describe/it/expect` from Jest. Assertion style: `assert.equal()`, `assert.deepEqual()`, `assert.ok()`, `assert.throws()`.

**Module system:** ESM (`"type": "module"`) — use `import`/`export`, not `require`/`module.exports`. File extensions in imports use `.js` (TypeScript resolution).

**Schema invariants (never get these wrong):**
- `picks.status` = lifecycle column (NOT `lifecycle_state`)
- `pick_lifecycle` = events table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (NOT pick id)
- `audit_log.entity_ref` = pick id as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = correction FK; original row is never mutated

**Data sources:** SGO API (`SGO_API_KEY`) and The Odds API (`ODDS_API_KEY`) via `apps/ingestor`. Both OpenAI and Anthropic Claude are in use in `packages/intelligence` and `apps/alert-agent`.

**Legacy boundary:** `C:\dev\unit-talk-production` is reference-only. No implicit truth import from legacy behavior. Any reused behavior must have a v2 artifact or runtime proof.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. Use `pnpm test` for unit tests, `pnpm test:db` for live DB smoke tests.
