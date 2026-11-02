# Diff summary: WORK-2026110203

Implementation files, from `git diff --stat origin/main...642f9a2e1 -- scripts .ops/work`:

```
 .ops/work/WORK-2026110203.md   |  66 ++++++++++
 scripts/ops/codex-exec.test.ts | 158 ++++++++++++++++++++++++
 scripts/ops/codex-exec.ts      | 271 ++++++++++++++++++++++++++++++++++++++++-
 3 files changed, 493 insertions(+), 2 deletions(-)
```

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | New `findCodexRollouts`, `observeModelRouting`, `unavailableObservation`, `codexSessionsRoot` and `observePullRequest`. `model-routing.json` gains `routing_source: "declared"` and an `observation` block. `main()` observes after the child exits, fails closed with `ROUTING_MISMATCH` after the evidence persists, and adds `observation_status` and a read-only `pr` field to its JSON result. |
| `scripts/ops/codex-exec.test.ts` | Seven tests: observed, unavailable (none and ambiguous), partial fields, mismatch (effort and model), the evidence defaults, the read-only PR report, and the order of the mismatch refusal. |
| `.ops/work/WORK-2026110203.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: set when the PR opens
