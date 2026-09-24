# WORK-2026092403 Diff Summary

Generated at: 2026-09-24T14:00:23.000Z
Issue: WORK-2026092403
Tier: T1
Lane type: governance
Branch: claude/work-2026092403-host-disk-hygiene
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1645
Head SHA: a435e7a9de1df5793bed08d54aa53ab9b2bc77a3
Merge SHA: fee65acf9f2346652cfd4f7067ec722def293e78
Diff base: decd67afaf99eeb41320c40eca14a9d9e9cf92a6 (origin/main)
Diff target: a435e7a9de1df5793bed08d54aa53ab9b2bc77a3

## Git Diff Stat
```
 .github/workflows/deploy-monitoring.yml       |  13 ++-
 .github/workflows/deploy.yml                  |  50 +++++++++
 .ops/sync/WORK-2026092403.yml                 | 154 ++++++++++++++++++++++++++
 deploy/production/docker-compose.yml          |  22 ++++
 docs/06_status/lanes/WORK-2026092403.json     |  39 +++++++
 docs/06_status/proof/WORK-2026092403/.gitkeep |   0
 scripts/ci/deploy-config-rollback.test.ts     | 143 ++++++++++++++++++++++++
 7 files changed, 419 insertions(+), 2 deletions(-)
```

## What changed

- `.github/workflows/deploy.yml`: new last promote step "Reclaim superseded release images"
  (`continue-on-error`). Keeps the running, previous and every configuration-snapshotted
  release; removes other images under `IMAGE_NAMESPACE` with a plain `docker image rm`.
- `deploy/production/docker-compose.yml`: `x-logging` anchor (json-file, 10m x 5) applied to all
  11 services.
- `.github/workflows/deploy-monitoring.yml`: cron logs under `${DEPLOY_PATH}/logs`, created
  before install.
- `scripts/ci/deploy-config-rollback.test.ts`: 5 tests, 2 of them executing the reclaim body.

## What did not change

No rollback path, no env-file write, no containment setting, no delivery target, no secret. No
deploy was dispatched.
