# UTV2-1170 Diff Summary

Generated at: 2026-05-26T09:09:00Z
Issue: UTV2-1170
Tier: T2
Lane type: governance
Branch: codex/utv2-1170-wire-loop-dispatch-governor-gates
Head SHA: daa17fcb
Merge SHA: N/A

## Summary

- Wired `/loop-dispatch` to the live governor command set: `ops:merge-risk`, `ops:execution-state`, `ops:lane-maximizer`, and `ops:orchestration-reconcile --current --json`.
- Replaced stale manual ghost-count, Codex-health, and fixed executor-cap prose with script-authoritative gates and `CONCURRENCY_CONFIG.json` as the lane-limit authority.
- Added regression coverage that asserts `/loop-dispatch` requires live gates before each cycle, bookends cycles with reconciliation, reports one repair command, and prints live executor state in the summary.

## Files Changed

- `.claude/commands/loop-dispatch.md` — live safety gates, cycle-start/cycle-end reconciliation, executor state summary, and concurrency-config authority.
- `scripts/ops/workflow-hardening.test.ts` — command-surface regression tests for the `/loop-dispatch` hardening contract.
- `.ops/sync/UTV2-1170.yml` — per-issue sync binding for branch discipline and verification.

## Scope

No runtime, migration, domain, DB, worker, or Tier C paths were changed.
