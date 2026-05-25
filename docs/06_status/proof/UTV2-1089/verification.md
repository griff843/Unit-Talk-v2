# Proof Summary — UTV2-1089

**Issue:** INIT-1.3.2 — Invariant Engine (Runtime Evaluable Set)
**Tier:** T1
**Lane type:** governance
**SHA:** cfe8e8d2d43f9f73099aae2d43dcc57c57b37fc7 (branch HEAD at proof assembly)

## What Changed

`packages/invariants/src/engine.ts` — new `InvariantEngine` class (extends `EventEmitter`) with full runtime evaluation of all 15 active invariants from `invariant-registry.json`. Exports: `InvariantEngine`, `InvariantViolation`, `RuntimeContext`.

Four invariants are runtime-evaluable from a context snapshot (`RUNTIME_EVALUABLE_IDS`):
- **INV-0009**: snapshot age > 24h → `data_freshness: stale`
- **INV-0010**: settlement latency > 5 min → latency violation
- **INV-0014**: outbox queue depth > 1000 → queue saturation
- **INV-0015**: circuit open + fail-closed → propagation guard

Eleven invariants are advisory evaluators that detect explicit context flags (INV-0001 to INV-0008, INV-0011 to INV-0013) — they require git/linear state and cannot be computed from a runtime snapshot alone.

`packages/invariants/src/index.ts` — updated to export `InvariantEngine`, `InvariantViolation`, `RuntimeContext`.

`.github/workflows/invariant-registry-gate.yml` — removed stale UTV2-1088 proof-binding step that was hardcoded to a SHA not present in live branch ancestry post-squash-merge.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — env, lint, type-check, build, test, command checks all green |
| Engine unit tests | PASS — 67/67 tests, 16 suites (`packages/invariants/src/engine.test.ts`) |
| Full invariants package | PASS — 497/497 tests across all invariants package files |
| pnpm test:db | PASS — 7/7 live-DB tests against Supabase zfzdnfwdarxucxtaojxm |
| R-level compliance | PASS (CI green) |
| Lane authority | PASS — lane_type: governance; packages/invariants + .github covered |
| Invariant registry gate | PASS — all 15 invariants validated, registry hash consistent |

## Adversarial Tests (per-invariant injection)

All 15 invariants tested with context injection:

- INV-0009: `snapshotAgeHours: 25` → violation emitted, `snapshotAgeHours: 23` → no violation
- INV-0010: `settlementLatencyMinutes: 6` → violation, `settlementLatencyMinutes: 4` → clean
- INV-0014: `outboxQueueDepth: 1001` → violation, `outboxQueueDepth: 999` → clean
- INV-0015: `circuitOpen: true, failClosed: true` → violation, either flag false → clean
- INV-0001 through INV-0008, INV-0011 through INV-0013: advisory flag injection → violation, no flag → clean
- `evaluateForReplay()`: replay_run_id threaded into all violation objects
- Event emitter: `engine.on('violation', ...)` receives all violations synchronously
- Empty context: returns empty array (no false positives)

## pnpm test:db — Live DB

7/7 tests passed against Supabase project `zfzdnfwdarxucxtaojxm` (`apps/api/src/database-smoke.test.ts`):

- Submission and settlement persistence round-trip — PASS
- UTV2-920: invalid atomic enqueue → no lifecycle event or outbox row — PASS
- UTV2-920: invalid atomic delivery confirmation rollback — PASS
- UTV2-920: invalid atomic settlement → no rows written — PASS
- UTV2-883: no duplicate participants for same external_id and sport — PASS
- UTV2-996: re-settling creates correction row, not duplicate base — PASS
- UTV2-996: correction chain is additive, original row not mutated — PASS
