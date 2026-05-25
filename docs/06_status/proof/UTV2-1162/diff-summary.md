# UTV2-1162 Diff Summary

Merged on main as `f991bc0bb4b9b9d05f405a1ba0207215a5b0eacf`.

## Summary

- Added queue/backlog intake support to `scripts/ops/lane-maximizer.ts` through `--from-queue` and `--from-linear`.
- Updated wave planning to rank candidates, block candidates missing file scope or acceptance criteria, and emit current `ops:lane-start` commands with `--tier`, `--branch`, `--executor`, `--lane-type`, and repeatable `--files`.
- Added focused `node:test` coverage for command generation, unsafe queue refusal, candidate ranking, and repo queue parsing.

## Files Changed

- `scripts/ops/lane-maximizer.ts` — queue/Linear candidate intake, ranking metadata, fail-closed unsafe candidate checks, and lane-start command generation.
- `scripts/ops/lane-maximizer.test.ts` — focused coverage for queue intake, ranking, unsafe candidates, and exact dispatch commands.

## Notes

- Earlier `pnpm ops:lane-maximizer` CLI smoke hit a sandbox `tsx` IPC `EPERM` before script code ran. The queue intake path is covered directly through `parseQueueCandidates()` and `evaluateCandidates()` in `scripts/ops/lane-maximizer.test.ts`.
- Added `.ops/sync/UTV2-1162.yml` as per-issue lane metadata so `ops:sync-check` resolves against this branch.
- Full `pnpm verify` passed after sync metadata was added.
