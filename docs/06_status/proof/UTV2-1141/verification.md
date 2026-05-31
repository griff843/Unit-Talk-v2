# Verification: UTV2-1141 — INIT-4.4.1 Attribution Engine

## Issue

UTV2-1141 — INIT-4.4.1 — Attribution Engine  
**Tier:** T2 | **Executor:** Claude | **Lane:** modeling  
**Merge SHA:** b611eec1af6c5a21064879aebfdce2b3c5fb6eca  
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/941

## Verification

| Check | Result |
|---|---|
| `pnpm type-check` | PASS |
| `pnpm test` (incl. `test:domain-analytics`) | PASS — 23/23 attribution tests |
| `scripts/ci/r-level-check.ts` | PASS — no artifacts required |
| `pnpm verify` (full pipeline) | PASS |

## Test Results

```
# tests 23  pass 23  fail 0
```

Covers:
- `validateAttributionInput` — required fields, finite values, valid result
- `attributePick` — win/loss/push PnL, component decomposition, stake scaling
- `reconstructAttribution` — determinism: same inputs → same record
- `decomposePerformance` — aggregate decomposition, insufficient_data exclusion

## Invariants Confirmed

- Components always sum to realized PnL (within floating-point rounding)
- Records without feature snapshot tagged `insufficient_data`, excluded from aggregate totals
- Fail-closed on missing pick_id, settled_at, invalid result, non-finite EV/CLV values
- `reconstructAttribution` is deterministic — same inputs always produce identical records
- `decomposePerformance` on empty input returns zero decomposition (no panic/throw)
- No capital/treasury/scaling surfaces activated

## Parallelism

File scope isolation confirmed — no overlap with UTV2-1137 (settlement corrections).
