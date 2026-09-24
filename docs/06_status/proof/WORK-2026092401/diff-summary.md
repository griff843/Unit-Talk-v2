# WORK-2026092401 Diff Summary

Generated at: 2026-09-24T12:46:23.000Z
Issue: WORK-2026092401
Tier: T1
Lane type: governance
Branch: claude/work-2026092401-conveyor-unprovisioned-state
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1643
Head SHA: 16727dd07d7a9556f4a5e9ac259e1032d1ee6364
Merge SHA: pending merge
Diff base: decd67afaf99eeb41320c40eca14a9d9e9cf92a6 (origin/main)
Diff target: 16727dd07d7a9556f4a5e9ac259e1032d1ee6364

## Git Diff Stat
```
 .github/workflows/warehouse-archive-conveyor.yml |   9 +-
 .ops/sync/WORK-2026092401.yml                    | 232 +++++++++++++++++++++++
 docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md |   6 +
 docs/06_status/lanes/WORK-2026092401.json        |  41 ++++
 docs/06_status/proof/WORK-2026092401/.gitkeep    |   0
 scripts/warehouse/cli.ts                         |  11 +-
 scripts/warehouse/config.test.ts                 |  71 +++++++
 scripts/warehouse/config.ts                      |  75 ++++++++
 scripts/warehouse/conveyor-workflow.test.ts      |  40 ++++
 9 files changed, 480 insertions(+), 5 deletions(-)
```

## What changed

- `scripts/warehouse/config.ts`: `ArchiveState`, `classifyArchiveState`, `archive_state` on
  `ConfigDescription`, and `renderDoctorSummary`, which is built from presence classes only.
- `scripts/warehouse/cli.ts`: `doctor` exits 0 only for `ready`, appends the summary to
  `GITHUB_STEP_SUMMARY` when set, and writes a one-line state to stderr. Stdout stays one JSON
  document.
- `.github/workflows/warehouse-archive-conveyor.yml`: header comment only. No step changed.
- `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md` §8: one bullet, "Unprovisioned is red, and
  says so".
- Tests: 6 in `config.test.ts` and 2 in `conveyor-workflow.test.ts`.
