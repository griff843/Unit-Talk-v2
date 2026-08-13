# Diff summary: UTV2-1698

MERGE_SHA: 68ee1ff9139abdb0945d6d44698f229b6f5c1ae0


## Summary

- Added `codex-exec --rework`, which invalidates completed `implement` through `closeout` phases before resume planning. Orient and plan evidence remains available, but rejected implementation cannot be skipped.
- Added `ops:exec-checkpoint invalidate --from <phase>` and `clear`; clearing removes both the primary checkpoint and its `.bak` resume sidecar.
- Made a re-dispatch carrying findings fail closed as `REWORK_NO_SOURCE_CHANGE` (exit 1) when no non-doc/non-operational source files changed. The result payload includes `source_files_changed`.

## Files changed

- `scripts/ops/execution-checkpoint.ts` — phase invalidation and artifact-complete checkpoint clearing.
- `scripts/ops/execution-checkpoint.test.ts` — rework resume and primary/sidecar clearing regressions.
- `scripts/ops/codex-exec.ts` — `--rework` wiring, source-diff accounting, and the non-success execution-truth verdict.
- `scripts/ops/codex-exec.test.ts` — zero-diff verdict, dispatch ordering, and source-diff filtering coverage.

## Boundaries

Only the issue's approved ops scripts, tests, and proof bundle are changed. No runtime, domain, database, or delivery code is touched.
