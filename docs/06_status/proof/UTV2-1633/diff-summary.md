# UTV2-1633 Diff Summary

Generated at: 2026-08-01T05:35:14.080Z
Issue: UTV2-1633
Tier: T1
Lane type: governance
Branch: claude/utv2-1633-proof-repair
PR URL: N/A
Head SHA: b273e89c82a83730d9a7f02b196c2cda50319553
Merge SHA: 2e690ca1e07c772525d69b03013518a65e6ed5c7
Diff base: 43709ca58df1e69998e1981255110b160642e0e5^1
Diff target: 43709ca58df1e69998e1981255110b160642e0e5

## Git Diff Stat
```
.lane/migration-lock.yml                           |  33 +--
 .ops/sync/UTV2-1633.yml                            |  10 +
 ...000000_utv2_1633_reporting_reader_role.down.sql |  62 ++++
 docs/06_status/lanes/UTV2-1633.json                |  40 +++
 docs/06_status/proof/UTV2-1633/.gitkeep            |   0
 docs/06_status/proof/UTV2-1633/evidence.json       | 173 +++++++++++
 docs/06_status/proof/UTV2-1633/verification.md     | 327 +++++++++++++++++++++
 package.json                                       |   2 +-
 .../utv2-1633-reporting-reader-role-guard.test.ts  | 232 +++++++++++++++
 ...60801000000_utv2_1633_reporting_reader_role.sql | 174 +++++++++++
 10 files changed, 1035 insertions(+), 18 deletions(-)
```

## Git Name Status
```
M	.lane/migration-lock.yml
A	.ops/sync/UTV2-1633.yml
A	db/migrations-rollback/20260801000000_utv2_1633_reporting_reader_role.down.sql
A	docs/06_status/lanes/UTV2-1633.json
A	docs/06_status/proof/UTV2-1633/.gitkeep
A	docs/06_status/proof/UTV2-1633/evidence.json
A	docs/06_status/proof/UTV2-1633/verification.md
M	package.json
A	scripts/ci/utv2-1633-reporting-reader-role-guard.test.ts
A	supabase/migrations/20260801000000_utv2_1633_reporting_reader_role.sql
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: b273e89c82a83730d9a7f02b196c2cda50319553
Merge SHA: 2e690ca1e07c772525d69b03013518a65e6ed5c7
