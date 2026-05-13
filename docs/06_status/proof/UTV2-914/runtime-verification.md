# Runtime Verification — UTV2-914

**Issue:** UTV2-914 — UT-P0-001 Protect Command Center
**Generated:** 2026-05-12
**Merge SHA:** _TBD — added at merge time and verified by truth-check H3_

Per `docs/05_operations/P0_PROTOCOL_SPEC.md` §3. Every `: PASS` item below is backed by a real command run, executed by the orchestrator against the lane worktree at `C:/Dev/Unit-Talk-v2-main/.out/worktrees/griffadavi__utv2-914-ut-p0-001-protect-command-center`.

---

## Static + unit verification

- [x] `pnpm test:command-center` exits 0 with 13/13 passes: PASS
  - Tests cover: service-role data client fail-closed in prod without CC auth, anon client bypass, API base URL resolution, CC API headers fail-closed in prod without API key, `assertCommandCenterAuthConfig` production check, basic+bearer auth flows, missing-credential rejection, operator identity resolution.
- [x] `pnpm verify` exits 0 with 113/113 tests across 13 suites: PASS
  - Includes type-check (zero errors), lint clean, full unit suite, command manifest verification (14 commands), migration version + lint guards (104 migrations checked).
- [x] `pnpm test:db` exits 0 with 2/2 live Supabase tests: PASS
  - `database repository bundle persists a submission and settlement when Supabase is configured` (89.7s)
  - `UTV2-883: no duplicate participants for the same external_id and sport` (1.97s)
- [x] R-level compliance check from worktree HEAD against `origin/main`: PASS
  - Verdict: PASS. No R-level artifacts required for this diff (changed-files count from `origin/main..HEAD` is 0 pre-commit; will re-verify post-commit).

## Auth-specific runtime verification

- [x] `apps/command-center/src/middleware.ts` exists and registers Next.js Edge middleware on all non-public routes: PASS
- [x] `assertCommandCenterAuthConfig` throws in production when `UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN` and `COMMAND_CENTER_AUTH_USERNAME`/`PASSWORD` are all missing: PASS
  - Verified by test `assertCommandCenterAuthConfig requires app auth in production` in `server-api.test.ts`.
- [x] `authenticateCommandCenterRequest` rejects missing-credential requests in production with 401 + WWW-Authenticate challenge: PASS
  - Verified by test `authenticateCommandCenterRequest rejects missing production credentials`.
- [x] `authenticateCommandCenterRequest` accepts valid Basic credentials: PASS
  - Verified by test `authenticateCommandCenterRequest accepts production basic auth`.
- [x] `authenticateCommandCenterRequest` accepts valid Bearer token: PASS
  - Verified by test `authenticateCommandCenterRequest accepts bearer token auth`.
- [x] `createDatabaseConnectionConfig` throws when `useServiceRole: true` and Command Center auth config is absent in production: PASS
  - Verified by test `service-role data client fails closed in production without Command Center auth` in `client.test.ts`.
- [x] `createDatabaseConnectionConfig` allows anon access without Command Center auth: PASS
  - Verified by test `anon data client does not require Command Center app auth`.
- [x] `resolveCommandCenterApiHeaders` fails closed in production when `UNIT_TALK_CC_API_KEY` is absent: PASS
  - Verified by test `resolveCommandCenterApiHeaders fails closed in production without API key`.
- [x] `apps/api/src/auth.ts` `loadAuthConfig` throws at startup when `failClosed && keys.size === 0`: PASS
  - Verified in updated `apps/api/src/auth.test.ts`.
- [x] `/api/qa/seed-pick` route requires operator role per `ROUTE_ROLES`: PASS
  - Verified by inspection of `apps/api/src/auth.ts` diff and `apps/api/src/server.ts` route registration.

## Observability verification

- [x] `logCommandCenterAuthFailure` emits structured log with code, route, method, requestId: PASS (code inspection)
- [x] `logCommandCenterPrivilegedAction` emits structured log with route, method, actor, role, requestId: PASS (code inspection)
- [x] Request ID propagation: middleware reads `x-request-id` or `x-correlation-id`, falls back to `crypto.randomUUID()`, sets downstream headers `x-request-id`, `x-command-center-actor`, `x-command-center-role`: PASS (code inspection)

## Rollback safety

- [x] No DB migrations in this diff: PASS (verified by `pnpm verify` migration lint)
- [x] Rollback path is to redeploy previous Command Center build (per issue spec's rollback consideration): PASS (no irreversible changes introduced)

## Captured command outputs

```
$ npx tsx scripts/ops/codex-health-check.ts --json
{ "healthy": true, "codex_available": true, "codex_version": "codex-cli 0.128.0" }

$ cd <worktree> && pnpm test:command-center
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ duration_ms 520.8924

$ cd <worktree> && pnpm verify
> tsx --test apps/api/src/submission-payload.test.ts
ℹ tests 113
ℹ pass 113
ℹ fail 0
ℹ duration_ms 655.9156
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 104 migration file(s) verified — no duplicate versions.
[lint-migrations] 104 migration file(s) checked — no findings.
EXIT=0

$ cd <worktree> && pnpm test:db
✔ database repository bundle persists a submission and settlement (89759.956ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (1975.3566ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
EXIT=0

$ cd <worktree> && npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 0
Rules matched: (none) — no R-level artifacts required for this diff
EXIT=0
```

## Deferred to post-merge — NOT marked PASS

- [ ] Post-merge `pnpm ops:truth-check UTV2-914` exits 0 with H1–H5 all PASS — _deferred; truth-check needs the real merge SHA to validate against_
- [ ] Production deploy of the Command Center build, with `UNIT_TALK_APP_ENV=production` + `UNIT_TALK_CC_API_KEY` + `UNIT_TALK_COMMAND_CENTER_AUTH_*` set — _deferred to PM/operator action_
- [ ] Live verification on production that unauthenticated requests receive 401, authenticated receive 200, audit logs emit — _deferred to post-deploy operator action_

---

result: pass
