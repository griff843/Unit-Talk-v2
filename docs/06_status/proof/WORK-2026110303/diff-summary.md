# Diff summary: WORK-2026110303

Scope of the figures below: implementation files and the work order only, excluding `docs/06_status/**` and `.ops/sync/**`. They come from `git diff --stat origin/main...HEAD -- scripts/ .ops/work/`.

```
 .ops/work/WORK-2026110303.md             |  62 +++++++
 scripts/ops/codex-exec.ts                |  11 +-
 scripts/ops/execution-checkpoint.test.ts | 292 +++++++++++++++++++++++++++++++
 scripts/ops/execution-checkpoint.ts      | 256 ++++++++++++++++++++++++++-
 4 files changed, 608 insertions(+), 13 deletions(-)
```

| File | Change |
|---|---|
| `scripts/ops/execution-checkpoint.ts` | Adds the `OrchestratorRuling` type and the optional `orchestrator_rulings` field on the checkpoint and the archived epoch. Validation accepts a missing field and requires each ruling to carry the current epoch and the `orchestrator` author. Adds `recordRuling`, which is refused while any attempt is open, for an unknown `--answers` finding, for empty text or when no checkpoint exists. Resume carries rulings; rework archives them and carries them rebased. `buildResumeBrief` renders "Orchestrator rulings — authoritative" before the findings. Adds `buildReworkBrief` and the `ruling` CLI subcommand, which is refused under `UNIT_TALK_EXECUTION_EPOCH_ID`. `clearCheckpoint` takes the caller's attempt identity and, under any identity, refuses with `execution_checkpoint_ruling_protected` when the primary, the sidecar or an archived epoch may hold a ruling, failing closed on unparseable state; the `clear` CLI passes `UNIT_TALK_EXECUTION_EPOCH_ID`. |
| `scripts/ops/execution-checkpoint.test.ts` | Eleven new tests: prompt rendering in attempt N+1, the in-progress refusal, phases and findings left intact, unknown-finding and empty-text refusal, rework carry, legacy compatibility, the ruling CLI executor-identity refusal, and four clear-guard tests (current and stale identity on a closed checkpoint, sidecar-only and archived-epoch rulings, unparseable state and ruling-free state, and the clear CLI). |
| `scripts/ops/codex-exec.ts` | The rework brief now comes from `buildReworkBrief`, which lists carried rulings. The rework resume plan carries `carried_rulings`. |
| `.ops/work/WORK-2026110303.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1825
