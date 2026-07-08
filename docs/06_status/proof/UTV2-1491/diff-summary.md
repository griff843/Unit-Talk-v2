# UTV2-1491 Diff Summary

Branch-head SHA (pre-merge): `b8eddf761dcd064b1eca13c376084ec7b2bc55ad`

## Summary

New `docs/05_operations/MULTI_AGENT_WORKTREE_PROTOCOL.md` codifying the safe pattern for
multiple agents/sessions sharing this repo with parallel lane worktrees, distilled from
the 2026-07-07 root-stabilization incident (root checkout found switched to a concurrent
session's feature branch mid-orchestration).

Covers: ownership model (lane executor vs main-checkout operator vs `ops:*` scripts),
session start via `ops:lane-start`, main-checkout boundary (control/merge only, no
branch-switch implementation), one-agent-per-worktree + no-dev-servers-from-root rule,
worktree session dos/don'ts, file-scope ownership, heartbeat/session continuity,
interruption/handoff states, PR/merge handoff, a lightweight review-worktree pattern with
exact `git worktree add`/`remove` commands (distinct from full lane-registered worktrees),
truth-hierarchy-based reconciliation, stop conditions, and a command reference.

## Files changed

- `docs/05_operations/MULTI_AGENT_WORKTREE_PROTOCOL.md` (new, 336 lines)

## Scope

Docs-only. No product code changes, no deploy, no lane manifest schema changes.

## Executor result

Drafted by Codex CLI via `scripts/ops/codex-exec.ts`; Codex hit its monthly usage quota
(resets 2026-08-06) after producing a substantial complete draft but before it could
commit/push/open the PR. Claude picked up per three-brain Rule 3 fallback: reviewed the
draft against the issue's acceptance criteria, found two gaps (no explicit
one-worktree-per-agent / no-dev-servers-from-root rule, and no exact review-worktree
create/remove commands distinct from `ops:lane-start`), added both sections, then ran
verification and opened the PR.

## R-level compliance

```
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```
