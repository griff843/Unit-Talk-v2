# PROOF: UTV2-1291 Verification
MERGE_SHA: 4ea34d255a2e476fe5aa2fd9ac8ba79b75fe2d70

## Verification

Commands run on branch `codex/utv2-1291-isolate-live-db-verify-pressure`.

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project references completed successfully. |
| `pnpm lint` | PASS | ESLint completed successfully. |
| `pnpm build` | PASS | TypeScript build completed successfully. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | `Rules matched: (none) — no R-level artifacts required for this diff`. |
| issue-specific verification | PASS | `rg` confirmed the proposal names `database-smoke`, representative `t1-proof-*`, `execution_intents`, the four required state labels, and the proposed `verify:static` / `test:live-db` split. |
| `pnpm test` | INTERRUPTED | Root test progressed through large portions of the suite with passing TAP output, then produced no output for several minutes during `test:ops`; it was stopped with exit 130 to avoid leaving an active session. |
| `pnpm verify` | FAIL | Static/local gates passed through `ops:sync-check`, `ops:system-alignment-check`, `ops:automation-coverage-check`, `env:check`, `lint`, `type-check`, `build`, and most of `pnpm test`; it failed in live `test:t1-proof`. |

## `pnpm verify` Failure Boundary

The full gate reached `test:t1-proof` and failed in `apps/api/src/t1-proof-awaiting-approval.test.ts`:

- `UTV2-519 brake path: system-pick-scanner` failed with `Failed to list settlements: canceling statement due to statement timeout`.
- `UTV2-519 brake path: alert-agent` failed with `Failed to list settlements: canceling statement due to statement timeout`.
- `UTV2-519 brake path: model-driven` failed with `Failed to list picks by lifecycle states: TypeError: fetch failed`.
- `UTV2-519 atomic rollback: mismatched fromState leaves picks.status and pick_lifecycle untouched` failed with `process_submission_atomic failed: canceling statement due to statement timeout`.

This is the live-DB degradation mode documented by the UTV2-1291 proposal. No workflow or runtime files were changed in this lane.
