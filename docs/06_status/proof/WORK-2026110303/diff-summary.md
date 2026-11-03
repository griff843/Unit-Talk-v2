# Diff summary: WORK-2026110303

Scope of the figures below: implementation files and the work order only, excluding `docs/06_status/**` and `.ops/sync/**`. They come from `git diff --stat origin/main...HEAD -- scripts/ .ops/work/`.

```
 .ops/work/WORK-2026110303.md             |  62 ++++++++++
 scripts/ops/codex-exec.ts                |  11 +-
 scripts/ops/execution-checkpoint.test.ts | 165 +++++++++++++++++++++++++++
 scripts/ops/execution-checkpoint.ts      | 189 ++++++++++++++++++++++++++++++-
 4 files changed, 417 insertions(+), 10 deletions(-)
```

| File | Change |
|---|---|
| `scripts/ops/execution-checkpoint.ts` | Adds the `OrchestratorRuling` type and the optional `orchestrator_rulings` field on the checkpoint and the archived epoch. Validation accepts a missing field and requires each ruling to carry the current epoch and the `orchestrator` author. Adds `recordRuling`, which is refused while any attempt is open, for an unknown `--answers` finding, for empty text or when no checkpoint exists. Resume carries rulings; rework archives them and carries them rebased. `buildResumeBrief` renders "Orchestrator rulings — authoritative" before the findings. Adds `buildReworkBrief` and the `ruling` CLI subcommand, which is refused under `UNIT_TALK_EXECUTION_EPOCH_ID`. |
| `scripts/ops/execution-checkpoint.test.ts` | Seven new tests: prompt rendering in attempt N+1, the in-progress refusal, phases and findings left intact, unknown-finding and empty-text refusal, rework carry, legacy compatibility, and the CLI executor-identity refusal. |
| `scripts/ops/codex-exec.ts` | The rework brief now comes from `buildReworkBrief`, which lists carried rulings. The rework resume plan carries `carried_rulings`. |
| `.ops/work/WORK-2026110303.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: pending merge
PR: pending
