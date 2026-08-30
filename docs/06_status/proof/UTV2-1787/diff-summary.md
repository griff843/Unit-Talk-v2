# UTV2-1787 Diff Summary

Generated at: 2026-08-30T13:19:33.474Z
Issue: UTV2-1787
Tier: T1
Lane type: runtime
Branch: codex/utv2-1787-smart-form-phase-1
PR URL: N/A
Head SHA: b18a0b829d1804eb604cf03dacba2b0454ae6431
Merge SHA: N/A
Diff base: c52c0a4623e1eff6cb2629adf6929a37e636003e
Diff target: b18a0b829d1804eb604cf03dacba2b0454ae6431

## Git Diff Stat
```
.ops/sync/UTV2-1787.yml                            | 547 +++++++++++++++++++++
 apps/api/src/controllers/requeue-controller.ts     |   6 +-
 .../src/controllers/retry-delivery-controller.ts   |   9 +
 .../src/controllers/submit-pick-controller.test.ts |  47 +-
 apps/api/src/controllers/submit-pick-controller.ts |  21 +-
 apps/api/src/distribution-service.test.ts          |  39 ++
 apps/api/src/distribution-service.ts               |  17 +-
 apps/api/src/handlers/submit-pick.ts               |  29 +-
 apps/api/src/http-integration.test.ts              |  88 +++-
 apps/api/src/smart-form-validation.test.ts         | 221 +++++++++
 apps/api/src/smart-form-validation.ts              | 241 +++++++++
 apps/api/src/submission-service.test.ts            |  20 +
 apps/smart-form/.env.example                       |   1 +
 apps/smart-form/app/login/page.tsx                 |  34 +-
 apps/smart-form/app/submit/components/BetForm.tsx  | 280 ++++++++++-
 .../app/submit/components/BetSlipPanel.tsx         |   2 +
 apps/smart-form/app/submit/page.tsx                |  24 +-
 apps/smart-form/auth.ts                            |   4 +-
 apps/smart-form/e2e/auth-gate.spec.ts              |  56 +++
 apps/smart-form/e2e/phase-one.spec.ts              | 267 ++++++++++
 apps/smart-form/e2e/smart-form-submission.spec.ts  | 110 ++---
 apps/smart-form/lib/auth-allowlist.ts              |  15 +
 apps/smart-form/lib/auth-config.ts                 |   7 +-
 apps/smart-form/lib/form-schema.ts                 |   3 +
 apps/smart-form/lib/form-utils.ts                  |  19 +
 apps/smart-form/test/allowlist.test.ts             |  23 +
 apps/smart-form/test/auth-config.test.ts           |   5 +-
 docs/06_status/lanes/UTV2-1787.json                |  62 +++
 docs/06_status/proof/UTV2-1787/.gitkeep            |   0
 .../proof/UTV2-1787/01-capper-portal-login.png     | Bin 0 -> 22331 bytes
 .../02-authenticated-smart-form-shell.png          | Bin 0 -> 106735 bytes
 .../UTV2-1787/03-ncaaf-structured-matchup.png      | Bin 0 -> 106973 bytes
 .../proof/UTV2-1787/04-ncaaf-moneyline-mobile.png  | Bin 0 -> 101472 bytes
 .../05-ncaaf-team-player-filter-mobile.png         | Bin 0 -> 116437 bytes
 .../proof/UTV2-1787/06-mlb-structured-desktop.png  | Bin 0 -> 149950 bytes
 .../UTV2-1787/07-manual-participant-override.png   | Bin 0 -> 127640 bytes
 docs/06_status/proof/UTV2-1787/model-routing.json  |  14 +
 package.json                                       |   2 +-
 packages/contracts/src/index.ts                    |   1 +
 packages/contracts/src/smart-form.ts               |  57 +++
 40 files changed, 2157 insertions(+), 114 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1787.yml
M	apps/api/src/controllers/requeue-controller.ts
M	apps/api/src/controllers/retry-delivery-controller.ts
M	apps/api/src/controllers/submit-pick-controller.test.ts
M	apps/api/src/controllers/submit-pick-controller.ts
M	apps/api/src/distribution-service.test.ts
M	apps/api/src/distribution-service.ts
M	apps/api/src/handlers/submit-pick.ts
M	apps/api/src/http-integration.test.ts
A	apps/api/src/smart-form-validation.test.ts
A	apps/api/src/smart-form-validation.ts
M	apps/api/src/submission-service.test.ts
M	apps/smart-form/.env.example
M	apps/smart-form/app/login/page.tsx
M	apps/smart-form/app/submit/components/BetForm.tsx
M	apps/smart-form/app/submit/components/BetSlipPanel.tsx
M	apps/smart-form/app/submit/page.tsx
M	apps/smart-form/auth.ts
A	apps/smart-form/e2e/auth-gate.spec.ts
A	apps/smart-form/e2e/phase-one.spec.ts
M	apps/smart-form/e2e/smart-form-submission.spec.ts
M	apps/smart-form/lib/auth-allowlist.ts
M	apps/smart-form/lib/auth-config.ts
M	apps/smart-form/lib/form-schema.ts
M	apps/smart-form/lib/form-utils.ts
M	apps/smart-form/test/allowlist.test.ts
M	apps/smart-form/test/auth-config.test.ts
A	docs/06_status/lanes/UTV2-1787.json
A	docs/06_status/proof/UTV2-1787/.gitkeep
A	docs/06_status/proof/UTV2-1787/01-capper-portal-login.png
A	docs/06_status/proof/UTV2-1787/02-authenticated-smart-form-shell.png
A	docs/06_status/proof/UTV2-1787/03-ncaaf-structured-matchup.png
A	docs/06_status/proof/UTV2-1787/04-ncaaf-moneyline-mobile.png
A	docs/06_status/proof/UTV2-1787/05-ncaaf-team-player-filter-mobile.png
A	docs/06_status/proof/UTV2-1787/06-mlb-structured-desktop.png
A	docs/06_status/proof/UTV2-1787/07-manual-participant-override.png
A	docs/06_status/proof/UTV2-1787/model-routing.json
M	package.json
M	packages/contracts/src/index.ts
A	packages/contracts/src/smart-form.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: b18a0b829d1804eb604cf03dacba2b0454ae6431
Merge SHA: N/A
