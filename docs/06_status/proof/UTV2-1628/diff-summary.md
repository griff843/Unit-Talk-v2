# UTV2-1628 Diff Summary

Generated at: 2026-07-31T00:53:16.509Z
Issue: UTV2-1628
Tier: T1
Lane type: governance
Branch: claude/utv2-1628-service-role-boundary
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1324
Head SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
Merge SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
Diff base: 69b1c37091e5d8984baa48e745ac1272123fa020^1
Diff target: 69b1c37091e5d8984baa48e745ac1272123fa020

## Git Diff Stat
```
.github/workflows/ci.yml                           |  12 +
 .ops/sync/UTV2-1628.yml                            |  10 +
 apps/command-center/src/lib/data/client.ts         |  50 +-
 apps/worker/src/worker-runtime.test.ts             |   9 +-
 docs/06_status/lanes/UTV2-1628.json                | 137 +++
 docs/06_status/proof/UTV2-1628/evidence.json       | 348 ++++++++
 docs/06_status/proof/UTV2-1628/verification.md     | 377 ++++++++
 package.json                                       |   8 +-
 packages/db/package.json                           |   4 +-
 packages/db/src/client.ts                          |  32 +-
 packages/db/src/index.ts                           |   2 +
 packages/db/src/privileged-client-boundary.test.ts | 186 ++++
 packages/db/src/privileged-client-boundary.ts      | 289 ++++++
 packages/db/src/target-identity.ts                 | 114 +++
 scripts/auto-settle-proof.ts                       |   4 +-
 scripts/backtest-weights.ts                        |   4 +-
 scripts/backup-alert-check.ts                      |   4 +-
 scripts/band-accuracy.ts                           |   4 +-
 scripts/board-probe.ts                             |   4 +-
 scripts/calibration-report.ts                      |   4 +-
 scripts/catalog-state.ts                           |   4 +-
 scripts/check-game-results.ts                      |   4 +-
 scripts/check-model-registry.ts                    |   4 +-
 scripts/check-participants.ts                      |   4 +-
 scripts/check-participants2.ts                     |   4 +-
 scripts/check-participants3.ts                     |   4 +-
 scripts/check-picks-live.ts                        |   4 +-
 scripts/check-status.ts                            |   4 +-
 scripts/ci/isolated-proof-attestation.ts           |  91 +-
 scripts/ci/privileged-db-client-guard.test.ts      | 426 +++++++++
 scripts/ci/privileged-db-client-guard.ts           | 975 +++++++++++++++++++++
 scripts/ci/privileged-db-client-inventory.json     | 814 +++++++++++++++++
 .../ci/rebuild-privileged-db-client-inventory.ts   | 254 ++++++
 scripts/ci/seed-staging-fixtures.ts                |   4 +-
 scripts/clv-check2.ts                              |   4 +-
 scripts/clv-hornets.ts                             |   4 +-
 scripts/clv-pick.ts                                |   4 +-
 scripts/clv-probe.ts                               |   4 +-
 scripts/clv-probe2.ts                              |   4 +-
 scripts/clv-proof.ts                               |   4 +-
 scripts/clv-setup.ts                               |   4 +-
 scripts/clv-trigger.ts                             |   4 +-
 scripts/clv-trigger2.ts                            |   4 +-
 scripts/clv-verify.ts                              |   4 +-
 scripts/db-check.ts                                |   4 +-
 scripts/db-lookup.ts                               |   6 +-
 scripts/db-role-validator.ts                       |   4 +-
 scripts/grading-alert-check.ts                     |   4 +-
 scripts/ingest-mlb-run-detail.ts                   |   4 +-
 scripts/ingestor-alert-check.ts                    |   4 +-
 scripts/ingestor-supervisor.ts                     |   4 +-
 scripts/m5-burn-in-check.ts                        |   4 +-
 .../run-ownership-persistence-proof.ts             |   5 +-
 scripts/ops/burn-in-snapshot.ts                    |   6 +-
 scripts/ops/db-health-tripwire.ts                  |  10 +-
 scripts/ops/edge-coverage-report.ts                |   4 +-
 scripts/ops/fix-settlement-utv2-665.ts             |   5 +-
 scripts/ops/ingestor-health-check.ts               |   6 +-
 scripts/ops/readiness-refresh.ts                   |   9 +-
 scripts/pi-m5-verify.ts                            |   4 +-
 scripts/pipeline-health.ts                         |   4 +-
 scripts/portfolio-review.ts                        |   4 +-
 scripts/proof-deep.ts                              |   4 +-
 scripts/proof-setup.ts                             |   4 +-
 scripts/proof/utv2-576-closing-line-proof.ts       |   6 +-
 scripts/prune-all-tables.ts                        |   4 +-
 scripts/prune-provider-offers.ts                   |   4 +-
 scripts/requeue-orphans.ts                         |   4 +-
 scripts/run-materializer-proof.ts                  |   4 +-
 scripts/run-migration-719.ts                       |   4 +-
 scripts/runtime-health.ts                          |   4 +-
 scripts/scoring-analysis.ts                        |   4 +-
 scripts/scoring-analysis2.ts                       |   4 +-
 scripts/scoring-analysis3.ts                       |   4 +-
 scripts/scoring-integrity-proof.ts                 |   4 +-
 scripts/scoring-provenance.ts                      |   4 +-
 scripts/scoring-raw.ts                             |   4 +-
 scripts/seed-model-registry-baseline.ts            |   4 +-
 scripts/sgo-historical-coverage.ts                 |   5 +-
 scripts/sgo-r5-replay-readiness.ts                 |   5 +-
 scripts/shadow-clv-parity.ts                       |   7 +-
 scripts/shadow-grading-parity.ts                   |   7 +-
 scripts/shadow-overlap-check.ts                    |   6 +-
 scripts/shadow-scoring-runner.ts                   |  14 +-
 scripts/stage-freshness-checks.ts                  |   4 +-
 scripts/stranded-picks-cleanup.ts                  |   4 +-
 scripts/system-check.ts                            |   6 +-
 scripts/t1-proof-bundle.ts                         |   4 +-
 scripts/utv2-252-provider-snapshot.ts              |   4 +-
 scripts/utv2-320-nba-alias-gap-report.ts           |   4 +-
 scripts/utv2-320-nba-baseline-benchmark.ts         |   4 +-
 scripts/utv2-320-nba-feature-audit.ts              |   4 +-
 scripts/utv2-320-nba-pick-metadata-audit.ts        |   4 +-
 scripts/utv2-320-nba-prop-coverage-audit.ts        |   4 +-
 scripts/utv2-320-nba-prop-segment-benchmark.ts     |   4 +-
 scripts/utv2-321-mlb-feature-audit.ts              |   4 +-
 scripts/utv2-54-verify.ts                          |   4 +-
 scripts/utv2-56-verify.ts                          |   4 +-
 scripts/verify-388.ts                              |   4 +-
 scripts/verify-719.ts                              |   4 +-
 scripts/verify-pick.ts                             |   4 +-
 scripts/worker-alert-check.ts                      |   4 +-
 scripts/worker-supervisor.ts                       |   4 +-
 103 files changed, 4231 insertions(+), 286 deletions(-)
```

## Git Name Status
```
M	.github/workflows/ci.yml
A	.ops/sync/UTV2-1628.yml
M	apps/command-center/src/lib/data/client.ts
M	apps/worker/src/worker-runtime.test.ts
A	docs/06_status/lanes/UTV2-1628.json
A	docs/06_status/proof/UTV2-1628/evidence.json
A	docs/06_status/proof/UTV2-1628/verification.md
M	package.json
M	packages/db/package.json
M	packages/db/src/client.ts
M	packages/db/src/index.ts
A	packages/db/src/privileged-client-boundary.test.ts
A	packages/db/src/privileged-client-boundary.ts
A	packages/db/src/target-identity.ts
M	scripts/auto-settle-proof.ts
M	scripts/backtest-weights.ts
M	scripts/backup-alert-check.ts
M	scripts/band-accuracy.ts
M	scripts/board-probe.ts
M	scripts/calibration-report.ts
M	scripts/catalog-state.ts
M	scripts/check-game-results.ts
M	scripts/check-model-registry.ts
M	scripts/check-participants.ts
M	scripts/check-participants2.ts
M	scripts/check-participants3.ts
M	scripts/check-picks-live.ts
M	scripts/check-status.ts
M	scripts/ci/isolated-proof-attestation.ts
A	scripts/ci/privileged-db-client-guard.test.ts
A	scripts/ci/privileged-db-client-guard.ts
A	scripts/ci/privileged-db-client-inventory.json
A	scripts/ci/rebuild-privileged-db-client-inventory.ts
M	scripts/ci/seed-staging-fixtures.ts
M	scripts/clv-check2.ts
M	scripts/clv-hornets.ts
M	scripts/clv-pick.ts
M	scripts/clv-probe.ts
M	scripts/clv-probe2.ts
M	scripts/clv-proof.ts
M	scripts/clv-setup.ts
M	scripts/clv-trigger.ts
M	scripts/clv-trigger2.ts
M	scripts/clv-verify.ts
M	scripts/db-check.ts
M	scripts/db-lookup.ts
M	scripts/db-role-validator.ts
M	scripts/grading-alert-check.ts
M	scripts/ingest-mlb-run-detail.ts
M	scripts/ingestor-alert-check.ts
M	scripts/ingestor-supervisor.ts
M	scripts/m5-burn-in-check.ts
M	scripts/model-ownership/run-ownership-persistence-proof.ts
M	scripts/ops/burn-in-snapshot.ts
M	scripts/ops/db-health-tripwire.ts
M	scripts/ops/edge-coverage-report.ts
M	scripts/ops/fix-settlement-utv2-665.ts
M	scripts/ops/ingestor-health-check.ts
M	scripts/ops/readiness-refresh.ts
M	scripts/pi-m5-verify.ts
M	scripts/pipeline-health.ts
M	scripts/portfolio-review.ts
M	scripts/proof-deep.ts
M	scripts/proof-setup.ts
M	scripts/proof/utv2-576-closing-line-proof.ts
M	scripts/prune-all-tables.ts
M	scripts/prune-provider-offers.ts
M	scripts/requeue-orphans.ts
M	scripts/run-materializer-proof.ts
M	scripts/run-migration-719.ts
M	scripts/runtime-health.ts
M	scripts/scoring-analysis.ts
M	scripts/scoring-analysis2.ts
M	scripts/scoring-analysis3.ts
M	scripts/scoring-integrity-proof.ts
M	scripts/scoring-provenance.ts
M	scripts/scoring-raw.ts
M	scripts/seed-model-registry-baseline.ts
M	scripts/sgo-historical-coverage.ts
M	scripts/sgo-r5-replay-readiness.ts
M	scripts/shadow-clv-parity.ts
M	scripts/shadow-grading-parity.ts
M	scripts/shadow-overlap-check.ts
M	scripts/shadow-scoring-runner.ts
M	scripts/stage-freshness-checks.ts
M	scripts/stranded-picks-cleanup.ts
M	scripts/system-check.ts
M	scripts/t1-proof-bundle.ts
M	scripts/utv2-252-provider-snapshot.ts
M	scripts/utv2-320-nba-alias-gap-report.ts
M	scripts/utv2-320-nba-baseline-benchmark.ts
M	scripts/utv2-320-nba-feature-audit.ts
M	scripts/utv2-320-nba-pick-metadata-audit.ts
M	scripts/utv2-320-nba-prop-coverage-audit.ts
M	scripts/utv2-320-nba-prop-segment-benchmark.ts
M	scripts/utv2-321-mlb-feature-audit.ts
M	scripts/utv2-54-verify.ts
M	scripts/utv2-56-verify.ts
M	scripts/verify-388.ts
M	scripts/verify-719.ts
M	scripts/verify-pick.ts
M	scripts/worker-alert-check.ts
M	scripts/worker-supervisor.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
Merge SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
