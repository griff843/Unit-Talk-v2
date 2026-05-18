# Evidence Bundle — UTV2-992

**Issue:** Deploy rollback proof  
**Tier:** T2  
**Branch:** `codex/utv2-992-deploy-rollback-proof`  
**Generated:** 2026-05-18

Closes UTV2-992

---

## Problem

The production deploy workflow had rollback code paths, but the lane needed a reproducible proof artifact that documents the exact rollback trigger inputs, ordered procedure, and post-rollback verification without making live Hetzner or production calls.

---

## Rollback Trigger Conditions

Source inspected: `.github/workflows/deploy.yml`

The Deploy workflow exposes `workflow_dispatch.inputs.rollback_tag`. During canary and production deploy jobs, that input is assigned to the job environment variable `ROLLBACK_TAG`.

Rollback is conditional:

1. The deploy job writes the candidate `IMAGE_TAG` to `.unit-talk-release`.
2. The deploy job pulls and starts the candidate containers.
3. The job normalizes `DEPLOY_HEALTH_URL` to the deep endpoint `/api/health?full=true`.
4. The job polls deep health 30 times with 10 seconds between attempts.
5. If health never succeeds and `ROLLBACK_TAG` is non-empty, the workflow calls:

```bash
bash deploy/rollback.sh --tag "$ROLLBACK_TAG" --host "$DEPLOY_HOST" --user "$DEPLOY_USER" --path "$DEPLOY_PATH"
```

Required inputs:

- `rollback_tag`: previous known-good image tag supplied to the Deploy workflow.
- `DEPLOY_HOST`: production host secret.
- `DEPLOY_USER`: production SSH user secret.
- `DEPLOY_PATH`: remote deploy directory secret.
- `DEPLOY_HEALTH_URL`: production health URL secret.
- `UNIT_TALK_DEPLOY_SSH_KEY`: SSH key secret for remote deploy access.
- `GHCR_PAT`: GHCR auth token for remote image pulls.

---

## Rollback Procedure

1. Identify the previous known-good image tag before dispatch.
2. Dispatch the Deploy workflow manually with `image_tag` set to the candidate release and `rollback_tag` set to the previous known-good tag.
3. Allow the `verify` job to complete, including `pnpm verify` and `npx tsx scripts/deploy-check.ts --skip-verify`.
4. Allow the `rollback-dry-run` job to run `bash deploy/rollback.sh --dry-run --tag "${{ inputs.rollback_tag || github.sha }}"`.
5. Allow image build and canary deploy to proceed.
6. During canary, wait for the workflow deep health loop against `/api/health?full=true`.
7. If canary health fails and `ROLLBACK_TAG` is set, the workflow invokes `deploy/rollback.sh` with tag, host, user, and path.
8. If canary succeeds, production promotion repeats the same deep health gate and rollback invocation pattern.
9. Do not improvise alternate remote commands; use the workflow rollback call or the same `deploy/rollback.sh --tag ... --host ... --user ... --path ...` command shape.

---

## Post-Rollback Health Verification

After rollback completes:

1. Re-run the deep health check against `DEPLOY_HEALTH_URL` normalized to `/api/health?full=true`.
2. Confirm the endpoint responds successfully.
3. Confirm the workflow job no longer reports the candidate failed health loop as active.
4. Confirm the restored image tag matches the requested `ROLLBACK_TAG`.
5. Preserve `artifacts/rollback-proof.json` as the structured before/rollback/after proof record for the lane.

This evidence bundle does not make live network calls to Hetzner or production.

---

## Generated Artifact

Script:

```bash
tsx scripts/ops/rollback-proof.ts
```

Output:

```text
artifacts/rollback-proof.json
```

The artifact records:

- `generated_at`
- rollback preconditions
- ordered rollback steps
- health check result
- readiness verdict

Local sandbox note: `tsx` is currently blocked by `spawn EPERM` at esbuild startup in this environment. The artifact was generated from the same static workflow/package inputs without contacting production.

---

## Readiness Gate

**Automatic rollback confidence: PARTIAL**

Rationale:

- `ROLLBACK_TAG` usage and rollback script invocation are present in both canary and production health-failure paths.
- The workflow includes a rollback dry-run job.
- The health gate is deterministic: `/api/health?full=true`, 30 attempts, 10 seconds between attempts.
- This proof is offline and intentionally skips live production health calls, so it cannot claim full production recovery proof.

---

## Verification

Commands required by the lane:

```bash
npx tsx scripts/ops/rollback-proof.ts
pnpm verify
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Current sandbox blocker:

```text
Error: spawn EPERM
at ChildProcess.spawn
at ensureServiceIsRunning (...\node_modules\esbuild\lib\main.js)
```

The blocker occurs before TypeScript user code executes and also affects trivial `pnpm exec tsx -e "console.log(1)"` invocations.
