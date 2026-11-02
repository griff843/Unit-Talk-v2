# Diff summary: WORK-2026110203

Implementation files, from `git diff --stat origin/main...0ed9dc5f0 -- scripts .ops/work`:

```
 .ops/work/WORK-2026110203.md   |  71 ++++++++++
 scripts/ops/codex-exec.test.ts | 204 +++++++++++++++++++++++++++
 scripts/ops/codex-exec.ts      | 308 ++++++++++++++++++++++++++++++++++++++++-
 3 files changed, 581 insertions(+), 2 deletions(-)
```

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | New `findCodexRollouts`, `observeModelRouting`, `unavailableObservation`, `codexSessionsRoot`, `checkpointRootMismatch` and `observePullRequest`. The observation records Codex's cumulative `token_usage` verbatim. `model-routing.json` gains `routing_source: "declared"` and an `observation` block. `main()` refuses with `PRECONDITION_FAILED` (exit 2) before spawning when the launch checkout's root differs from the lane worktree's root, observes after the child exits, fails closed with `ROUTING_MISMATCH` after the evidence persists, and adds `observation_status` and a read-only `pr` field to its JSON result. |
| `scripts/ops/codex-exec.test.ts` | Nine tests: observed, unavailable (none and ambiguous), partial fields, mismatch (effort and model), the evidence defaults, the read-only PR report, the order of the mismatch refusal, `checkpointRootMismatch` against a real `git worktree`, and an end-to-end dry-run refusal from a launch root that is not the worktree's. |
| `.ops/work/WORK-2026110203.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1820
