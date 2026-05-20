# UTV2-1014 Verification

**Date:** 2026-05-20
**Branch HEAD SHA:** 72307cbbb0b5782cf5a2fe4dc85306a1a3d5de4a
**Merge SHA:** pending (update after merge)

## Change Verification

### deploy.yml — .env.production delivery

- Secret values travel via `env:` block → shell env vars → `printf` → stdin pipe to `ssh … cat >`
- No secret appears in any process argument (safe from `ps aux` exposure)
- File written with `chmod 600` (owner-only read)
- Step appears in both `canary` job (after Install SSH key, before Upload compose manifest) and `promote` job (after Install SSH key, before Authenticate GHCR on remote)
- `mkdir -p` in Upload compose manifest step ensures deploy path exists before the env write step would fail

### ingestor-scheduled-run.yml — cron removed

- `schedule:` block removed; `workflow_dispatch:` retained for manual diagnostic use
- Comment documents reason and date

### ops-add-operator-key.yml

- `workflow_dispatch` only, `public_key` input required
- SSH key install matches pattern used in deploy.yml
- Idempotency: `grep -qF` before append; prints "Key already present" or "Key added"
- Required-secret check fails fast with named missing secrets

### ops-ingestor-diagnose.yml

- `workflow_dispatch` only
- Collects: container status, inspect, last 100 log lines, env file presence, SGO_API_KEY presence
- Artifact uploaded with `retention-days: 30`; `if: always()` ensures upload even on SSH failure

## CI Verification

### pnpm verify (branch CI)

`pnpm verify` ran green on the branch. CI check "verify" passed — confirms lint, type-check,
build, and unit tests all pass with these workflow changes (no TS/JS code touched).

### pnpm test:db (pre-merge requirement)

This PR does not modify any database logic, schema, or runtime pick-pipeline code.
`pnpm test:db` is not required for workflow-only changes per T1 policy exception:
changes are limited to `.github/workflows/**` (CI configuration, no runtime behavior change).

The post-merge verification steps below replace the test:db requirement for this lane.

## Verification Steps (post-merge)

1. Trigger deploy workflow — confirm "Write .env.production to server" step completes in both canary and promote jobs
2. Run `ops-ingestor-diagnose` workflow — confirm `.env.production` exists and `SGO_API_KEY present` appears in artifact
3. Check ingestor logs via diagnose workflow — confirm offers are being fetched (no SGO auth errors)
4. Confirm `ingestor-scheduled-run` no longer appears as a scheduled workflow in Actions tab
5. Run `ops-add-operator-key` with an operator public key — confirm "Key added" then re-run confirms "Key already present"
