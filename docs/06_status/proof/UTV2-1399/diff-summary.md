# UTV2-1399 Diff Summary

Generated at: 2026-08-01T03:11:16.254Z
Issue: UTV2-1399
Tier: T1
Lane type: governance
Branch: claude/utv2-1399-proof-repair
PR URL: N/A
Head SHA: b70636258186c388ff1ba51901c34a08e51b281c
Merge SHA: c44b3469d222dca19ba611c759b59c16298bdb18
Diff base: fdc193582f94ad7538fa594b475847eb81a3647f^1
Diff target: fdc193582f94ad7538fa594b475847eb81a3647f

## Git Diff Stat
```
.lane/migration-lock.yml                           |  34 +-
 .ops/sync/UTV2-1399.yml                            |  10 +
 ...1399_fixture_excluding_reporting_views.down.sql |  51 ++
 docs/06_status/lanes/UTV2-1399.json                |  45 ++
 docs/06_status/proof/UTV2-1399/.gitkeep            |   0
 .../proof/UTV2-1399/corrected-inventory.json       | 145 +++++
 docs/06_status/proof/UTV2-1399/evidence.json       | 274 +++++++++
 docs/06_status/proof/UTV2-1399/verification.md     | 633 +++++++++++++++++++++
 package.json                                       |   2 +-
 scripts/ci/utv2-1399-reporting-view-guard.test.ts  | 189 ++++++
 scripts/generate-types.mjs                         |  20 +-
 ...utv2_1399_fixture_excluding_reporting_views.sql | 326 +++++++++++
 12 files changed, 1710 insertions(+), 19 deletions(-)
```

## Git Name Status
```
M	.lane/migration-lock.yml
A	.ops/sync/UTV2-1399.yml
A	db/migrations-rollback/20260731000000_utv2_1399_fixture_excluding_reporting_views.down.sql
A	docs/06_status/lanes/UTV2-1399.json
A	docs/06_status/proof/UTV2-1399/.gitkeep
A	docs/06_status/proof/UTV2-1399/corrected-inventory.json
A	docs/06_status/proof/UTV2-1399/evidence.json
A	docs/06_status/proof/UTV2-1399/verification.md
M	package.json
A	scripts/ci/utv2-1399-reporting-view-guard.test.ts
M	scripts/generate-types.mjs
A	supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: b70636258186c388ff1ba51901c34a08e51b281c
Merge SHA: c44b3469d222dca19ba611c759b59c16298bdb18
