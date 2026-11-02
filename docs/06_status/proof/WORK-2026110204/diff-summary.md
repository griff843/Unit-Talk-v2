# Diff summary: WORK-2026110204

Issue: WORK-2026110204

Tier: T2

Branch: codex/work-2026110204-checkpoint-dir-env

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | Pass the parent checkpoint directory to the child environment and remove the launch-root refusal. |
| `scripts/ops/codex-exec.test.ts` | Cover child environment propagation and phase recording across separate repositories; release all allocated temporary workspaces. |
| `scripts/ops/execution-checkpoint.ts` | Resolve `--dir`, then the non-empty environment override, then the repository default. |
| `scripts/ops/execution-checkpoint.test.ts` | Exercise CLI precedence and default behavior in child processes. |

## SHA Binding

Execution SHA: `0907b0400fae61aa9031d5a0da18cf05429aec4b` (attempt start SHA from the execution checkpoint).

Merge SHA: pending.

PR: pending; Production Claude opens it when the staging slot is free.
