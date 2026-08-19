# UTV2-1718 Diff Summary

Generated at: 2026-08-17T10:15:04.944Z
Issue: UTV2-1718
Tier: T1
Lane type: migration
Branch: claude/utv2-1718-migration-refusal-drill
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1428
Head SHA: aa4d4cfc4d528a7ef4e9f684c08f914f9ba0cfd7
Merge SHA: 3ce86b98a5aa01ae244794253a8c7e716f2ce733
Diff base: 3ce86b98a5aa01ae244794253a8c7e716f2ce733^1
Diff target: 3ce86b98a5aa01ae244794253a8c7e716f2ce733

## Git Diff Stat
```
.github/workflows/migration-reversibility-gate.yml |  188 +
 .ops/sync/UTV2-1718.yml                            |   10 +
 ...utv2_1540_command_center_ledger_repair.down.sql |   26 +
 docs/06_status/lanes/UTV2-1718.json                |   42 +
 docs/06_status/proof/UTV2-1718/evidence.json       |  226 ++
 docs/06_status/proof/UTV2-1718/verification.md     |  171 +
 packages/db/src/database.types.ts                  | 4277 +++-----------------
 scripts/ci/migration-precondition-drill.ts         |  300 ++
 ...0000_utv2_1540_command_center_ledger_repair.sql |  242 ++
 9 files changed, 1791 insertions(+), 3691 deletions(-)
```

## Git Name Status
```
M	.github/workflows/migration-reversibility-gate.yml
A	.ops/sync/UTV2-1718.yml
A	db/migrations-rollback/20260803230000_utv2_1540_command_center_ledger_repair.down.sql
A	docs/06_status/lanes/UTV2-1718.json
A	docs/06_status/proof/UTV2-1718/evidence.json
A	docs/06_status/proof/UTV2-1718/verification.md
M	packages/db/src/database.types.ts
A	scripts/ci/migration-precondition-drill.ts
A	supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: aa4d4cfc4d528a7ef4e9f684c08f914f9ba0cfd7
Merge SHA: 3ce86b98a5aa01ae244794253a8c7e716f2ce733
