# Verification Log — UTV2-927: Staging Environment Parity

## Branch
`codex/utv2-927-staging-environment-parity` — branch SHA `407bcae56d335bb7f8e55417df35950006f0cfa8`

## Merge
Squash-merged to main as SHA `15b37b6de5cb23bdbc0e094a2209fa39e1271508` (PR #676, merged 2026-05-15T12:04:24Z)

## Verification Steps

### pnpm type-check
```
> pnpm exec tsc -b tsconfig.json
(exit 0 — no errors)
```

### pnpm test
```
ℹ tests 183
ℹ suites 6
ℹ pass 183
ℹ fail 0
ℹ duration_ms 17492.86
```

### Staging-specific test results
```
✔ staging parity checks pass with correct staging env and compose
✔ staging parity checks fail when UNIT_TALK_APP_ENV is not staging
✔ staging parity checks reject production env_file in staging compose
✔ staging parity checks fail when required staging secrets are missing from workflow
✔ staging parity checks enforce fail_closed runtime modes
```

## Acceptance Criteria

- [x] Pre-deploy parity check fails on missing service/config — `collectStagingParityChecks` blocks missing services, wrong APP_ENV, wrong runtime modes, production env_file use, missing secrets
- [x] Staging has same service shape as production — `deploy/staging/docker-compose.yml` has all 4 services (api/worker/ingestor/discord-bot) with same healthcheck/depends_on structure
- [x] Parity contract is testable — 5 dedicated tests with clear pass/fail conditions
- [x] Staging deploy workflow exists — `.github/workflows/staging-deploy.yml` with parity gate
- [x] No TypeScript errors
- [x] All tests pass (183/183)
