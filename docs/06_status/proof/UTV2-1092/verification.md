# Verification Log — UTV2-1092 INIT-1.2.3

## Issue
INIT-1.2.3 — Replay Divergence Engine

## Verification

### pnpm verify (package tests)
**Result:** PASS  
12 new tests pass. Pre-existing F1-F7 migration gate failures on main (unrelated to this diff) excluded.

### pnpm test:db (Live Supabase)
**Result:** PASS  
7/7 tests pass. Duration: ~107s. Real Supabase DB — not in-memory.

### R-level check
**Result:** PASS  
No R-level artifacts required for this diff.

## Adversarial Validation

Three adversarial scenarios:

1. **Floating point non-determinism**: `0.85` vs `0.8500000000000001` — classified as divergence if JSON serializations differ.

2. **Nested object divergence**: `{ metadata: { confidence: 0.9 } }` vs `{ metadata: { confidence: 0.89 } }` — detected via recursive JSON serialization.

3. **Null vs undefined**: `settlement_status: null` vs `settlement_status: undefined` — `JSON.stringify(null) !== JSON.stringify(undefined)` → divergence.

## Escalation verified
- `'divergence'` event fires before throw — enables Governance Reviewer routing without catching the error
- `getReports()` accessible post-throw for proof bundle population

## Definition of Complete — satisfied
- [x] Divergence detected, halts the run, escalates
- [x] Runtime enforcement exists
- [x] Adversarial validation passed (3 scenarios)
- [x] Proof bundle exists
- [x] `ReplayDivergenceReport` is a first-class escalation artifact
