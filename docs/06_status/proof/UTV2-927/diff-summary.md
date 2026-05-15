# Diff Summary — UTV2-927: Staging Environment Parity

## Issue
Production deploy confidence was weak because staging had no codified parity contract. There was no staging deploy workflow, no staging compose file, and no automated check that staging mirrors production's service set, runtime modes, or secrets shape.

## Changes

### `scripts/deploy-check.ts`
- Added `REQUIRED_STAGING_DEPLOY_SECRETS` constant listing 5 staging-specific secrets
- Added `collectStagingParityChecks(repoRoot?, environment?, stagingWorkflowText?)`:
  - Asserts `UNIT_TALK_APP_ENV=staging`
  - Requires same env vars as production (SUPABASE_URL, all RUNTIME_MODE, etc.)
  - Enforces `fail_closed` runtime modes on staging (same as production)
  - Rejects `UNIT_TALK_WORKER_DRY_RUN=true` on staging
  - Validates `deploy/staging/docker-compose.yml` mirrors production service set
  - Checks each service uses `.env.staging` (not `.env.production`)
  - Verifies healthcheck and depends_on parity with production
  - Checks staging deploy workflow references all 5 staging secrets

### `scripts/staging-check.ts` (new)
- Thin CLI runner for `collectStagingParityChecks` (mirrors `deploy-check.ts` main())

### `deploy/staging/docker-compose.yml` (new)
- Mirrors `deploy/production/docker-compose.yml` exactly except:
  - Uses `.env.staging` env_file instead of `.env.production`
  - API port offset: `4001:4000` (avoids collision with production on same host)

### `.github/workflows/staging-deploy.yml` (new)
- `workflow_dispatch` triggered staging deploy (manual, no auto-trigger)
- Jobs: `parity-check` → `build` (matrix: api/worker/ingestor/discord-bot) → `deploy`
- Uses `UNIT_TALK_STAGING_DEPLOY_*` secrets (5 secrets, isolated from production secrets)
- Tags staging images with `${SHA}-staging` to distinguish from production images
- No rollback path (staging can be rebuilt from scratch)

### `scripts/deploy-check.test.ts`
- Added 5 staging parity tests: pass check, wrong APP_ENV, env_file isolation, missing secrets, fail_closed enforcement

## Result
- 183/183 tests pass (5 new staging parity tests)
- `pnpm type-check` green
- Staging parity is now a codified, testable contract

## Merge
Squash-merged to main as SHA `15b37b6de5cb23bdbc0e094a2209fa39e1271508` (PR #676, merged 2026-05-15T12:04:24Z)
