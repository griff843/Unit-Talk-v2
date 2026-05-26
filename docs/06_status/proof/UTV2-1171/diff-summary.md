# UTV2-1171 Diff Summary

Generated at: 2026-05-26T12:05:00Z
Issue: UTV2-1171
Tier: T2
Lane type: governance
Branch: codex/utv2-1171-align-dispatch-board-governor
Head SHA: see PR head
Merge SHA: N/A

## Summary

- Aligned `/dispatch` Phase 0 with the live governor and reconciliation gates used by `/loop-dispatch`.
- Aligned `/dispatch-board` preflight and routing language with the same `ops:merge-risk`, `ops:execution-state`, `ops:lane-maximizer`, and `ops:orchestration-reconcile --current --json` sequence.
- Removed stale hard-coded executor cap prose and stale reconcile wording from active dispatch docs.

## Files Changed

- `.claude/commands/dispatch.md` — live gate sequence, repair-command handling, config-backed executor limits, and worktree-only lane execution language.
- `.claude/commands/dispatch-board.md` — live gate sequence, config-backed slot language, and updated reconcile/truth-check wording.
- `scripts/ops/workflow-hardening.test.ts` — regression coverage for shared dispatch-surface gates and stale command references.

## Scope

No runtime, migration, domain, DB, worker, or Tier C paths were changed.
