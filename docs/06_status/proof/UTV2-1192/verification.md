# UTV2-1192 Verification

Date: 2026-05-29

## Commands

- `pnpm ops:proof-check UTV2-1020 --post-merge` — PASS
  - Proof path: `docs/06_status/proof/UTV2-1020/evidence.json`
  - Proof source SHA: `e7d3216f3e093cc4a9e4b16cae89182f0afc05af`
  - Current head SHA: `e7d3216f3e093cc4a9e4b16cae89182f0afc05af`
  - Warning: legacy schema v1 proof detected; `merge_sha` checked; v2 staleness validation skipped
- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm verify` — PASS
  - `ops:sync-check`, `ops:system-alignment-check`, `ops:automation-coverage-check`, `env:check`, `lint`, `type-check`, `build`, `test`, and `verify:commands` completed successfully.
  - Final visible gate lines: command manifest verified 14 commands; 114 migration versions verified; 114 migration files linted with no findings.

## Notes

The root test and verify runs emitted known stranded-pick warnings from live DB proof tests. The commands exited 0 and no stranded rows were modified by this lane.

## SHA Binding
merge_sha: 6248a6845c1fd283d1677e5471554399cceea163

## Verification Commands
- pnpm type-check: PASS
- pnpm test: PASS
- pnpm verify: PASS
- scripts/ci/r-level-check.ts: PASS
