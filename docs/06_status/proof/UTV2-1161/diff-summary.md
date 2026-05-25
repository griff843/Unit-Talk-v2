# UTV2-1161 Diff Summary

## Summary

- Extended `scripts/ops/execution-state.ts` lane summaries with lane age, heartbeat age, branch drift, PR state, check state, proof readiness, merge readiness, conflict risk, and a single recommended action.
- Added best-effort live telemetry hydration from local Git remote refs and `gh pr list`; the command degrades to `unknown` states when GitHub telemetry is unavailable.
- Updated `scripts/ops/execution-state.test.ts` coverage for lane/PR/check/drift display behavior and ready-to-merge action selection.

## Scope

- Runtime/domain/migration files were not changed.
- Code changes are limited to the allowed ops execution-state implementation and test files.

