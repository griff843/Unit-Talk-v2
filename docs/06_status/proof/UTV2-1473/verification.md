# PROOF: UTV2-1473 Verification

Issue: UTV2-1473
Tier: T1
Branch: claude/utv2-1473-preflight-pb2-flake
MERGE_SHA: c0d5a6082d4917916e5c2c3ec324988bbd6d968f

The SHA above is the implementation commit; post-merge closeout rebinds proof to the squash-merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] Root cause identified with evidence, not speculation: five test files read `process.env` directly for distribution-target routing (`resolveDeliveryTarget`, `readConfiguredWorkerTargets`) and Supabase-backed persistence-mode selection (`hasDatabaseEnvironment`) without isolating themselves from the ambient shell environment
- [x] Reproduced deterministically by toggling exactly one variable (whether `local.env` was sourced before the test command) — not a flake
- [x] Fixed by isolating the specific ambient env keys each file's assertions depend on (`UNIT_TALK_APP_ENV`, `UNIT_TALK_DISTRIBUTION_TARGETS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the full set of keys `packages/config/src/env.test.ts` exercises), matching the save/delete/restore pattern already established in `distribution-service.test.ts`
- [x] `pnpm ops:preflight` for the queued T1 lane's branch passes PB2 with the fix in place, with `local.env` sourced (the exact failure condition)
- [x] `pnpm test` passes cleanly (exit 0) 3 consecutive times with `local.env` sourced
- [x] The queued T1 lane this issue blocks is unblocked (blocking relationship removed once this closes)

## Verification

Executed 2026-07-05 from the lane worktree; raw output in EVIDENCE below.

- `pnpm type-check` — PASS
- `pnpm test:db` — PASS (7/7 against live Supabase)
- `pnpm test` (full aggregate, `local.env` sourced) — PASS, 3 consecutive runs, exit 0 each time
- `pnpm ops:preflight` for the queued lane's branch — PB2 PASS
- `pnpm verify` — fails only in the pre-existing SGO-outage live-data precondition (environmental, out of scope — detail below); all static steps pass

## EVIDENCE:

```text
pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)

pnpm test:db (live Supabase, project zfzdnfwdarxucxtaojxm)
# tests 7
# pass 7
# fail 0
# skipped 0

pnpm test (local.env sourced) — 3 consecutive runs:
run 1: exit=0
run 2: exit=0
run 3: exit=0

pnpm ops:preflight for the queued lane's branch
| PB1 | PASS | pnpm type-check passed |
| PB2 | PASS | pnpm test passed |
(only PX5 fails: T1 expected proof dir missing — a pre-lane-start chicken-and-egg
 for the queued lane's not-yet-started lane, unrelated to PB2 / this issue)

pnpm verify
not ok 1 - findExistingCombinations is bounded by the snapshot window and completes fast on live partitioned history (UTV2-1282)
error: 'recent event must have at least one existing combination inside the 72h window'
location: apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts
```

## Verify blocker (environmental, out of scope)

`pnpm verify` fails only in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` — a live-data precondition asserting SGO ingestion within a 72h window. The SGO API key has been inactive at the vendor since 2026-06-30, so this assertion fails on every branch regardless of change. All static verify steps (lint, type-check, build, unit test) pass; `pnpm test:db` passed separately. This lane touches only the five test files listed below; the failing file is unrelated and outside scope.

## Root-cause detail (per file)

| File | Ambient var(s) that leaked in | Effect |
|---|---|---|
| `apps/api/src/submission-service.test.ts` | `UNIT_TALK_APP_ENV=local` (redirects all non-canary delivery to `discord:canary`); `UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary` (restricts worker-target coverage, throws `DistributionTargetMismatchError` once the canary redirect no longer masks it); `UNIT_TALK_ENABLED_TARGETS` (if set in the caller's shell, restricts which promotion targets `resolveTargetRegistry` considers enabled at all) | 9 tests asserting best-bets/trader-insights outbox rows failed |
| `apps/api/src/server.test.ts` | same three vars | 3 tests (requeue x2, routing-preview) failed |
| `apps/api/src/qa-seed.test.ts` | `UNIT_TALK_APP_ENV` / `UNIT_TALK_DISTRIBUTION_TARGETS` | 1 test (seed-pick enqueue) failed |
| `apps/worker/src/worker-runtime.test.ts` | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` present in ambient env flips `persistenceMode` to `'database'` even inside the test's own fixture-dir chdir, since `hasDatabaseEnvironment()` reads live `process.env`, not the fixture's file-scoped values | 1 test failed |
| `packages/config/src/env.test.ts` | `loadEnvironment(rootDir)` merges file-parsed fixture values with already-present `process.env` entries, process.env taking precedence, for every key the file's 4 fixture tests assert on (SGO keys including `SGO_API_KEYS` — read directly by `collectConfiguredSgoApiKeys`, distinct from the singular `SGO_API_KEY` — staging mode, target vars, ingestor DB/archive vars) | 4 tests failed |

## PM revision (round 2) — additional isolation

PM_VERDICT: CHANGES_REQUIRED (round 1) identified two remaining ambient-env gaps not covered by the round-1 fix:

- [x] `UNIT_TALK_ENABLED_TARGETS` isolated in `submission-service.test.ts` and `server.test.ts` (gates `resolveTargetRegistry`'s enabled-target check, separate code path from the worker-coverage check `UNIT_TALK_DISTRIBUTION_TARGETS` already covered)
- [x] `SGO_API_KEYS` isolated in `packages/config/src/env.test.ts` (read directly via `process.env.SGO_API_KEYS` in `collectConfiguredSgoApiKeys`, not covered by the already-isolated singular `SGO_API_KEY` / `SGO_API_KEY_FALLBACK`)
- [x] Re-verified with `local.env` sourced: targeted subset (`submission-service.test.ts` + `server.test.ts` + `env.test.ts`) 126/126 pass; full `pnpm test` 3 consecutive clean runs (exit 0 each); `pnpm type-check` clean; `pnpm ops:preflight UTV2-1473 --tier T1 --branch claude/utv2-1473-preflight-pb2-flake` — PB2 PASS

```text
targeted subset (local.env sourced): 126/126 pass, 0 fail

pnpm test (local.env sourced) — 3 consecutive runs:
run 1: exit=0
run 2: exit=0 (17 + 19 relevant suites shown clean)
run 3: exit=0, 0 "not ok" lines

pnpm type-check → PASS, zero errors

pnpm ops:preflight UTV2-1473 --tier T1 --branch claude/utv2-1473-preflight-pb2-flake
| PB1 | PASS | pnpm type-check passed |
| PB2 | PASS | pnpm test passed |
(PG2/PL3/PL5 fails in this run are expected: working tree had the
 not-yet-committed fix, and the lane manifest is already status=started —
 unrelated to PB2 / this issue)
```

## Why this was not caught until now

These files were written and pass individually (`tsx --test <file>` or `pnpm test:<subset>`) whenever the developer's shell has NOT sourced `local.env`. CI runners never source `local.env` (no such file exists there), so this was invisible in CI. It only manifests when a developer/agent runs the full `pnpm test` suite (or `pnpm ops:preflight`, which internally requires `local.env`-sourced credentials for its own T1 Supabase health check) with `local.env` present in the shell — exactly the condition every T1 preflight invocation requires.
