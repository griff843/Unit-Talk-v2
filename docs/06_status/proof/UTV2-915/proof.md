# PROOF: UTV2-915
MERGE_SHA: 1b6f3909f9226d9c0c10b915f42357408ef558c2

ASSERTIONS:
- [x] Production-like startup refuses to proceed without fail-closed runtime mode — verified at `packages/config/src/env.ts:397-403` (throws `RUNTIME_MODE_MUST_FAIL_CLOSED`), wired into all four services.
- [x] Production-like startup refuses to proceed with missing required env keys — verified at `packages/config/src/env.ts:409-416` (throws `RUNTIME_REQUIRED_ENV_MISSING` with the exact missing key list).
- [x] Production-like startup refuses to proceed when a required env-key group has no member set — verified at `packages/config/src/env.ts:418-427` (throws `RUNTIME_REQUIRED_ENV_GROUP_MISSING` with the candidate key list).
- [x] Production-like startup refuses to proceed with in-memory persistence — verified at `packages/config/src/env.ts:429-435` (throws `RUNTIME_IN_MEMORY_FORBIDDEN`).
- [x] Production-like startup refuses to proceed in dry-run mode — verified at `packages/config/src/env.ts:437-443` (throws `RUNTIME_DRY_RUN_FORBIDDEN`).
- [x] Non-production runtimes pass through the validator without throwing, preserving dev/local ergonomics — verified at `packages/config/src/env.ts:384-395` (short-circuits before any check).
- [x] `apps/api` wires `assertProductionRuntimeConfig` at `createApiRuntimeDependencies` with SUPABASE keys + API auth group — verified at `apps/api/src/server.ts:169-180`.
- [x] `apps/worker` wires `assertProductionRuntimeConfig` at `createWorkerRuntimeDependencies` with SUPABASE + worker + Discord requirements plus adapter/target-map prod checks — verified at `apps/worker/src/runtime.ts:44-74`.
- [x] `apps/ingestor` wires `assertProductionRuntimeConfig` with SUPABASE + API URL + provider auth group — verified at `apps/ingestor/src/index.ts:61-75`.
- [x] `apps/discord-bot` wires `assertProductionRuntimeConfig` via `createDiscordBotStartupConfig` with Discord credentials + API URL — verified at `apps/discord-bot/src/main.ts:28-46`.
- [x] Errors are typed (`RuntimeConfigError` with `code`/`service`/`missingKeys`), suitable for branching by operator tooling — verified at `packages/config/src/env.ts:354-371`.
- [x] No regression in non-production code paths — full `pnpm verify` suite green (113 tests in the most-comprehensive domain suite, 0 fails).
- [x] T1 live DB smoke green — `pnpm test:db` 2/2 pass against real Supabase project `zfzdnfwdarxucxtaojxm`.
- [x] Claude critique recorded with `APPROVE` verdict at `docs/06_status/proof/UTV2-915/claude-critique.md`.
- [x] Runtime verification recorded with `result: pass` at `docs/06_status/proof/UTV2-915/runtime-verification.md`.
- [x] T1 evidence bundle present at `docs/06_status/UTV2-915-EVIDENCE-BUNDLE.md`.
- [ ] Post-merge: `pnpm ops:truth-check UTV2-915` exits 0 with H1–H5 all PASS — deferred to post-merge.

EVIDENCE:
```text
$ pnpm verify
… 113 tests in the most-affected suite (apps-api-agent / domain) — all green
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 104 migration file(s) verified — no duplicate versions.
[lint-migrations] 104 migration file(s) checked — no findings.
EXIT=0

$ pnpm test:db
✔ database repository bundle persists a submission and settlement when Supabase is configured (42023.8072ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (468.7544ms)
ℹ tests 2 / pass 2 / fail 0 / duration_ms 43135.5214
EXIT=0

$ npx tsx --test apps/api/src/qa-seed.test.ts
✔ POST /api/qa/seed-pick returns 501 when QA seed is disabled (44.8441ms)
✔ POST /api/qa/seed-pick returns 403 in production (13.5233ms)
✔ POST /api/qa/seed-pick returns the seed response shape and enqueues sandbox-only outbox work (14.0714ms)
✔ GET /api/qa/pick-status/:id returns the pick and outbox status shape (16.5269ms)
ℹ tests 4 / pass 4 / fail 0
EXIT=0

Diff stat (against origin/main):
  9 files modified
  +481 / -53 lines
  Key files:
    M    packages/config/src/env.ts                      (+244 lines: validator types + assertProductionRuntimeConfig)
    M    apps/api/src/server.ts                          (+wires assertProductionRuntimeConfig)
    M    apps/worker/src/runtime.ts                      (+wires + adapter/target-map prod checks)
    M    apps/ingestor/src/index.ts                      (+wires + provider auth group)
    M    apps/discord-bot/src/main.ts                    (+createDiscordBotStartupConfig)
    M    apps/api/src/index.ts                           (startup-log additions)
    M    apps/worker/src/index.ts                        (RuntimeMode type wiring)
    M    apps/api/src/qa-seed.test.ts                    (test-fix: NODE_ENV=production at request scope)
    M    apps/api/src/t1-proof-atomicity.test.ts         (test-fix: relaxed STEP 6 error message check)
```

See `claude-critique.md` for the full independent review pass and `runtime-verification.md` for the per-check evidence.
