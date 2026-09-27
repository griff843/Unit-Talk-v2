# Diff summary: UTV2-1956

MERGE_SHA: pending merge

| File | Change |
|---|---|
| `scripts/ops/preflight.ts` | Moves `WORK_ORDER_TIER_PATTERN` and `TERMINAL_MANIFEST_STATUSES` above the module-level `main()` invocation, with a comment explaining why. No logic change. |
| `scripts/ops/preflight.test.ts` | Adds one structural test: no module-level `const`/`let`/`class` is declared below the `main()` invocation. It is red on the shipped code. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1665
Execution SHA: ff3198e161c8e8d027dc552c23d78a6a3735f44a
