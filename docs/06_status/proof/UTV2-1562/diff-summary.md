# UTV2-1562 — Diff Summary

## Scope

Child issue of UTV2-1553 (T1). Narrow fix to `scripts/ops/lane-close.ts`, split out at PM's direction because the parent issue's tier (T1) cannot be inherited by a narrower fragment without full T1 rigor — see PM verdict on PR #1261.

## Files changed

- `scripts/ops/lane-close.ts`
- `scripts/ops/lane-close.test.ts`

## What changed

1. `finalizeLaneCloseManifest()` re-reads the manifest from disk before writing `status: 'done'`, so a fresh `truth_check_history` entry written by `runTruthCheck()`'s own side effect is not clobbered by a stale in-memory snapshot held by a caller from before that call.
2. `finalizeLaneCloseManifest()` now takes the passing `TruthCheckResult` that authorized the close (`authorizedTruthCheck`) and verifies the manifest's *latest* history entry still matches it exactly (`verdict: 'pass'`, `checked_at`, `merge_sha`) before flipping status. If a concurrent truth-check run landed between authorization and finalization — one that changed, failed, or advanced the manifest — this now throws `TruthCheckDriftError` and refuses to close, instead of silently certifying a close nobody authorized.
3. Added `CloseoutFailureCode: 'truth_check_drift'` and a matching CLI error branch/remediation string.

## Why

Found live while reconciling a related lane-close terminal-close case: a lane's manifest can show `status: 'done'` while its own last recorded `truth_check_history` entry is a fail from hours earlier, because the finalize step never checked what it was actually finalizing on top of. This directly violates the fail-closed invariant (never silently mark done).

## Tests added

- Existing regression (adapted): concurrent `runTruthCheck()` side-effect write is preserved through finalization.
- New regression: a truth-check that changed/failed/advanced between authorization and finalization causes a refusal (`TruthCheckDriftError`), and the on-disk manifest is left exactly as the concurrent run left it (not `done`).
