# PROOF: UTV2-914
MERGE_SHA: TBD-on-merge

ASSERTIONS:
- [x] Unauthenticated Command Center access is impossible in production (AC #1) — verified via `apps/command-center/src/middleware.ts` and tests in `server-api.test.ts`.
- [x] All Command Center mutations require authorized role (AC #2) — verified via `resolveCommandCenterApiHeaders` (CC side) + `/api/qa/seed-pick` operator-only routing in `apps/api/src/auth.ts` ROUTE_ROLES.
- [x] Privileged actions emit audit evidence (AC #3) — `logCommandCenterPrivilegedAction` and `logCommandCenterAuthFailure` invoked on every middleware traversal.
- [x] Production startup fails if Command Center auth config is absent (AC #4) — `loadAuthConfig` throws on `failClosed && keys.size === 0`; `assertCommandCenterAuthConfig` throws when required; `createDatabaseConnectionConfig` throws on service-role request without auth config.
- [x] Service-role DB access is mechanically tied to Command Center auth config (audit's #1 finding fixed at the right layer) — `createDatabaseConnectionConfig({ useServiceRole: true })` now calls `assertCommandCenterAuthConfig` before returning the elevated client.
- [x] No regression in non-Command-Center code paths — full repo test suite (113 unit + 2 live DB) passes.
- [x] Claude critique recorded with `APPROVE` verdict and explicit PM action items.
- [x] Runtime verification recorded with `result: pass`, no FAIL or SKIP items.
- [x] T1 evidence bundle present at `docs/06_status/UTV2-914-EVIDENCE-BUNDLE.md`.
- [ ] Post-merge: `pnpm ops:truth-check UTV2-914` exits 0 with H1–H5 all PASS — deferred to post-merge.

EVIDENCE:
```text
$ pnpm test:command-center
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ duration_ms 520.8924

$ pnpm verify
ℹ tests 113
ℹ pass 113
ℹ fail 0
ℹ duration_ms 655.9156
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 104 migration file(s) verified — no duplicate versions.
[lint-migrations] 104 migration file(s) checked — no findings.

$ pnpm test:db
✔ database repository bundle persists a submission and settlement (89759ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (1975ms)
ℹ tests 2 / pass 2 / fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff

Diff stat (against origin/main):
  11 files modified + 2 new = 13 files total
  +1452 / -297 lines
  Key files:
    NEW  apps/command-center/src/middleware.ts (82 lines)
    NEW  apps/command-center/src/lib/data/client.test.ts
    M    apps/api/src/auth.ts                          (+failClosed; UNIT_TALK_CC_API_KEY; /api/qa/seed-pick operator-only)
    M    apps/command-center/src/lib/server-api.ts     (+authenticateCommandCenterRequest, audit log helpers, constant-time eq)
    M    apps/command-center/src/lib/data/client.ts    (+service-role gated by assertCommandCenterAuthConfig)
```

See `claude-critique.md` for the full independent review pass and `runtime-verification.md` for the per-check evidence.
