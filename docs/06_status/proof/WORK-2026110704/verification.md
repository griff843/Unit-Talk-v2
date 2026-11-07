# PROOF: WORK-2026110704

MERGE_SHA: pending merge

Evidence bundle v1 (tier T1, lane type runtime).

## Metadata

| Field | Value |
|---|---|
| Issue ID | WORK-2026110704 |
| Tier | T1 |
| Phase / Gate | T1 review candidate; final verdict in "FINAL VERDICT" below |
| Owner | codex-cli/WORK-2026110704 |
| Date | 2026-11-07 |
| Verifier Identity | codex-cli/WORK-2026110704 |
| Commit SHA(s) | c2130be76c7f1beaea49189649ec69027e52e4b0 (implementation) |
| Related PRs | https://github.com/griff843/Unit-Talk-v2/pull/1837 |

## Scope

The grading cron catches rejected cycle bookkeeping, retries with bounded exponential backoff,
reports exhaustion through the existing ops callback and rejects. Its entrypoint exits 1.
Successful cycles write a local marker; the compose healthcheck checks freshness within three polls.
Defaults: five consecutive failures; delays 1s, 2s, 4s, 8s (30s cap); ops alert gets at most 5s.
Poll cadence, grading/settlement services, provider settings, containment and other deploy config are unchanged.
Runtime proof is synthetic fault injection. No production restart, deployment, host change or data writes occurred.
Live DB proof, PM approval, merge, merge-SHA binding and post-merge closeout remain pending.

## ASSERTIONS:

- [x] Transient bookkeeping failures recover and reset the consecutive-failure budget (E1, 23/23 focused tests).
- [x] Continuous failures exhaust the bounded budget, alert within 5 s, reject and exit 1 (E2).
- [x] Missing, stale, malformed or future liveness markers are unhealthy (E3).
- [x] Removing the outer try/catch fails the recovery tests (E4, mutation).
- [x] Only the grading-cron healthcheck changed in deploy config (E5).
- [x] Static verification passes on exact head 25f066444cc43fb98c7f43295f989034a1fe6f74 (E6).
- [x] Writable live-DB proof passes on exact head 25f066444cc43fb98c7f43295f989034a1fe6f74 in CI against staging (E7).

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | All three bookkeeping faults recover and reset the consecutive budget | test | grading-cron.test.ts | PASS | [E1](#e1-failure-injection-transcript) |
| 2 | Continuous faults cap attempts/backoff, alert, reject, exit 1 and leave a stale marker | test | grading-cron.test.ts | PASS | [E2](#e2-terminal-failures) |
| 3 | Missing/stale markers are unhealthy; fresh markers are healthy | test | grading-cron.test.ts | PASS | [E3](#e3-freshness) |
| 4 | Removing the outer try/catch breaks transient recovery | test | isolated mutation | PASS | [E4](#e4-mutation) |
| 5 | Only grading-cron healthcheck changed in deploy config | git-artifact | git diff | PASS | [E5](#e5-scope) |
| 6 | Required static verification passes | test | pnpm verify:static | PASS | [E6](#e6-static-verification) |
| 7 | Writable live DB verification passes | test | CI Writable DB proof (staging only) | PASS | [E7](#e7-live-db-deferred) |

## EVIDENCE:

### E1 Failure-injection transcript

Command: `pnpm exec tsx --test apps/api/src/grading-cron.test.ts (grading-cron-health: test) apps/api/src/grading-cron.test.ts`

```text
TAP version 13
# Subtest: liveness is unhealthy when missing, expired, malformed or future; healthy within three polls
ok 1 - liveness is unhealthy when missing, expired, malformed or future; healthy within three polls
  ---
  duration_ms: 17.281304
  type: 'test'
  ...
# Subtest: runGradingCronCycles executes each cycle and sleeps between runs
ok 2 - runGradingCronCycles executes each cycle and sleeps between runs
  ---
  duration_ms: 3.813075
  type: 'test'
  ...
# Subtest: runGradingCronCycles records failures and continues to the next cycle
ok 3 - runGradingCronCycles records failures and continues to the next cycle
  ---
  duration_ms: 0.637597
  type: 'test'
  ...
# Subtest: startGradingCronLoop writes heartbeat system_run on each cycle
ok 4 - startGradingCronLoop writes heartbeat system_run on each cycle
  ---
  duration_ms: 9.643749
  type: 'test'
  ...
# Subtest: startGradingCronLoop emits staleness warning when grading.run gap exceeds threshold
ok 5 - startGradingCronLoop emits staleness warning when grading.run gap exceeds threshold
  ---
  duration_ms: 1.994243
  type: 'test'
  ...
# Subtest: startGradingCronLoop does not emit staleness warning when grading.run is recent
ok 6 - startGradingCronLoop does not emit staleness warning when grading.run is recent
  ---
  duration_ms: 1.37805
  type: 'test'
  ...
# Subtest: runGradingCronCycles shares a single retry state across cycles
ok 7 - runGradingCronCycles shares a single retry state across cycles
  ---
  duration_ms: 0.335061
  type: 'test'
  ...
# Subtest: fetchAllByLifecycleState paginates through more than 1000 picks
ok 8 - fetchAllByLifecycleState paginates through more than 1000 picks
  ---
  duration_ms: 3.23124
  type: 'test'
  ...
# Subtest: grading health alert opens once for stale input and deduplicates repeats
ok 9 - grading health alert opens once for stale input and deduplicates repeats
  ---
  duration_ms: 0.455042
  type: 'test'
  ...
# Subtest: fresh successful work clears an alert across intervening no-op runs
ok 10 - fresh successful work clears an alert across intervening no-op runs
  ---
  duration_ms: 0.40333
  type: 'test'
  ...
# Subtest: readiness consumes degraded grading outcome as blocking RED input
ok 11 - readiness consumes degraded grading outcome as blocking RED input
  ---
  duration_ms: 1852.606439
  type: 'test'
  ...
# Subtest: readiness treats a genuine empty no-op as healthy, not an incident
ok 12 - readiness treats a genuine empty no-op as healthy, not an incident
  ---
  duration_ms: 1984.602226
  type: 'test'
  ...
# Subtest: readiness accepts a nothing-gradeable pass and refuses a no-input claim that examined rows
ok 13 - readiness accepts a nothing-gradeable pass and refuses a no-input claim that examined rows
  ---
  duration_ms: 3463.877789
  type: 'test'
  ...
# Subtest: PM-ratified five-value grading model is understood by readiness
ok 14 - PM-ratified five-value grading model is understood by readiness
  ---
  duration_ms: 9915.744132
  type: 'test'
  ...
# Subtest: loop recovers from transient startRun failures and resets the consecutive budget
ok 15 - loop recovers from transient startRun failures and resets the consecutive budget
  ---
  duration_ms: 10.069742
  type: 'test'
  ...
# Subtest: continuous startRun failure rejects, alerts, exits and leaves the liveness marker stale
ok 16 - continuous startRun failure rejects, alerts, exits and leaves the liveness marker stale
  ---
  duration_ms: 60.3958
  type: 'test'
  ...
# Subtest: loop recovers from transient completeRun failures and resets the consecutive budget
ok 17 - loop recovers from transient completeRun failures and resets the consecutive budget
  ---
  duration_ms: 1.82067
  type: 'test'
  ...
# Subtest: continuous completeRun failure rejects, alerts, exits and leaves the liveness marker stale
ok 18 - continuous completeRun failure rejects, alerts, exits and leaves the liveness marker stale
  ---
  duration_ms: 8.579924
  type: 'test'
  ...
# Subtest: loop recovers from transient listByType failures and resets the consecutive budget
ok 19 - loop recovers from transient listByType failures and resets the consecutive budget
  ---
  duration_ms: 2.985181
  type: 'test'
  ...
# Subtest: continuous listByType failure rejects, alerts, exits and leaves the liveness marker stale
ok 20 - continuous listByType failure rejects, alerts, exits and leaves the liveness marker stale
  ---
  duration_ms: 7.975072
  type: 'test'
  ...
# Subtest: entrypoint exits even when the ops alert rejects
ok 21 - entrypoint exits even when the ops alert rejects
  ---
  duration_ms: 2.248854
  type: 'test'
  ...
# Subtest: a hung ops alert cannot keep an exhausted loop alive
ok 22 - a hung ops alert cannot keep an exhausted loop alive
  ---
  duration_ms: 5003.239021
  type: 'test'
  ...
# Subtest: liveness write failures use the same bounded recovery policy
ok 23 - liveness write failures use the same bounded recovery policy
  ---
  duration_ms: 3.56295
  type: 'test'
  ...
1..23
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 24326.392519
```

### E2 Terminal failures

See E1 tests `continuous startRun/completeRun/listByType failure rejects, alerts, exits and leaves the liveness marker stale`.
Each asserts exactly five attempts, delays [10,20,20,20]ms, one exhaustion alert, rejected loop,
injected exit [1] and stale marker. Rejected and hung alert callbacks also reach exit [1].
Test: `apps/api/src/grading-cron.test.ts`; command: `tsx --test apps/api/src/grading-cron.test.ts`.

### E3 Freshness

See E1 `apps/api/src/grading-cron.test.ts (grading-cron-health: test)` test:
`liveness is unhealthy when missing, expired, malformed or future; healthy within three polls`.
Command: `tsx --test apps/api/src/grading-cron.test.ts (grading-cron-health: test)`.
The inclusive bound is three poll intervals; the next millisecond is unhealthy.

### E4 Mutation

An isolated copy in `/tmp/WORK-2026110704-mutation-9zf1i6p4` removed the outer loop's try/catch
and retry handler while retaining the cycle body. The working source was unchanged.
The temporary copy linked the same API dependencies. Command:
`pnpm exec tsx --test --test-name-pattern='loop recovers from transient' /tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts`

Expected mutation exit: 1. Each failure reports the injected repository error.

```text
TAP version 13
# Subtest: loop recovers from transient startRun failures and resets the consecutive budget
not ok 1 - loop recovers from transient startRun failures and resets the consecutive budget
  ---
  duration_ms: 10.140005
  type: 'test'
  location: '/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:20:3409'
  failureType: 'testCodeFailure'
  error: |-
    The validation function is expected to return "true". Received false

    Caught error:

    Error: injected startRun
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  stack: |-
    async TestContext.<anonymous> (/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:551:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: loop recovers from transient completeRun failures and resets the consecutive budget
not ok 2 - loop recovers from transient completeRun failures and resets the consecutive budget
  ---
  duration_ms: 1.710058
  type: 'test'
  location: '/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:20:3409'
  failureType: 'testCodeFailure'
  error: |-
    The validation function is expected to return "true". Received false

    Caught error:

    Error: injected completeRun
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  stack: |-
    async TestContext.<anonymous> (/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:551:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: loop recovers from transient listByType failures and resets the consecutive budget
not ok 3 - loop recovers from transient listByType failures and resets the consecutive budget
  ---
  duration_ms: 1.420477
  type: 'test'
  location: '/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:20:3409'
  failureType: 'testCodeFailure'
  error: |-
    The validation function is expected to return "true". Received false

    Caught error:

    Error: injected listByType
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  stack: |-
    async TestContext.<anonymous> (/tmp/WORK-2026110704-mutation-9zf1i6p4/grading-cron.test.ts:551:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..3
# tests 3
# suites 0
# pass 0
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1838.392654
```

### E5 Scope (HISTORICAL: diff shown predates the node probe; see FINAL VERDICT)

Command: `git diff origin/main -- deploy/production/docker-compose.yml`

```diff
diff --git a/deploy/production/docker-compose.yml b/deploy/production/docker-compose.yml
index d729db6a0..ab3ee9212 100644
--- a/deploy/production/docker-compose.yml
+++ b/deploy/production/docker-compose.yml
@@ -138,7 +138,7 @@ services:
       api:
         condition: service_healthy
     healthcheck:
-      test: ["CMD-SHELL", "pgrep -f 'grading-cron' > /dev/null || exit 1"]
+      test: ["CMD", "node_modules/.bin/tsx", "apps/api/src/grading-cron-health.ts"]
       interval: 60s
       timeout: 10s
       start_period: 30s
```

No existing tests were removed. Nine cron cases plus one health case were added.
No new `any` casts. All changed paths are authorized implementation or explicitly required proof artifacts.

### E6 Static verification (HISTORICAL: records the pre-fold FAIL, superseded by FINAL VERDICT)

`pnpm type-check`: PASS (exit 0). Initial TS2352 errors in incomplete new test repositories were
fixed by using `createInMemoryRepositoryBundle`; the final type-check passes.

`pnpm test`: PASS (serial exit 0; 7890 test executions in TAP summaries, 13 skipped); completed batch counts at capture: 7890.
`pnpm verify` invokes `pnpm verify:static` then live DB proof. FAIL: WIRING_TEST_UNWIRED_NEW; grading-cron.test.ts needs package.json test-script wiring, outside the authorized file scope. Scope addition requested.

```text
[WARN] WIRING_BASELINE_TEST_ENTRY_EXPIRED scripts/provider-offer-history-retention-summarize.test.ts - baseline entry expired on 2026-10-31; wire it, re-quarantine it with a new expiry, or remove it
[WARN] WIRING_BASELINE_TEST_ENTRY_EXPIRED scripts/provider-offers-quarantine-prune-fix.test.ts - baseline entry expired on 2026-10-31; wire it, re-quarantine it with a new expiry, or remove it
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ci/check-promotion-target-sync.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/apply-branch-protection.sh - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/architecture-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/ci-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/codex-wrapper.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/container-e2e-proof.sh - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/contrarian-review.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/edge-coverage-report.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/edge-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/migrate-lane-types.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/observability-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/ops-safety-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/remaining-infra-proofs.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/replay-failed-delivery.sh - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/rollback-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/service-runtime-proof.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_BASELINE_CAPABILITY_ENTRY_EXPIRED scripts/ops/sync-check.ts - capability disposition expired on 2026-10-31
[WARN] WIRING_GLOB_SHADOWED apps/qa-agent/src/**/*.test.ts - POSIX sh expands "**" as a single path segment, so 1 file(s) under this pattern never run: apps/qa-agent/src/adapters/unit-talk/surfaces/discord/skills/pick-delivery.test.ts```

Final standalone `pnpm test` tail:

```text
ok 7 - evidence is independently read, hashed and counted through the reader path
  ---
  duration_ms: 189.561797
  type: 'test'
  ...
# Subtest: missing or mutated archive evidence refuses before a database is opened
ok 8 - missing or mutated archive evidence refuses before a database is opened
  ---
  duration_ms: 15.812154
  type: 'test'
  ...
1..8
# tests 8
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 1705.737376
```

R-level command: `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

No R1–R5 path rules match this change. Final tracked-file system alignment check: PASS.

### E7 Live DB deferred (HISTORICAL: superseded by exact-head CI proof in FINAL VERDICT)

Command: `pnpm test:db` (exit 1 before any writable test).

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL
(packet: host=unparseable; measured local guard: host=127.0.0.1). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
No override or attempt to bypass staging identity was made.

## Acceptance Criteria Mapping

| Criterion | Assertion/evidence |
|---|---|
| Transient startRun/completeRun/listByType recovery | 1 / E1 |
| Bounded exhaustion, alert, rejected promise and injected exit | 2 / E1–E2 |
| Fresh/missing/stale marker | 3 / E1–E3 |
| Existing grading, settlement, retry-state and alert tests | E6 |
| Healthcheck-only deploy change | 5 / E5 |
| No grading-service/settlement-service/packages/workflow edits | E5 |
| Mutation proof | 4 / E4 |

## FINAL VERDICT

This section is authoritative. Where an earlier section (E5, E6, E7, or the first-draft wording) conflicts with it, this section wins; those earlier sections are kept only as history.

| Item | Final state |
|---|---|
| Failure-injection (E1-E4) | PASS: apps/api/src/grading-cron.test.ts 23/23; mutation (outer try/catch removed) fails the 3 transient-recovery tests |
| Static verification | PASS: the WIRING_TEST_UNWIRED_NEW failure was resolved without a scope change by folding the liveness test into the already-wired grading-cron.test.ts; package.json untouched; `pnpm verify:static` exit 0 |
| Live DB proof | PASS in CI against staging (xskgrzbteyqdufktjrjx): run 42398274218 attempt 1, head 25f066444cc43fb98c7f43295f989034a1fe6f74, `pnpm test:db` exit 0, 9/9. This is the generic DB smoke suite; it does not run the cron loop. Re-confirm on the final head in the PR checks |
| Healthcheck | Plain `node -e` probe (about 59 MB; the replaced tsx probe peaked about 190 MB). Rule: marker present, not in the future, age <= 3 x poll. Poll read from the container's own UNIT_TALK_GRADING_CRON_POLL_MS, positive integer, default 300000, identical to grading-cron.ts parsing |
| Deployed poll config | Repository sets no UNIT_TALK_GRADING_CRON_POLL_MS (compose has no override; .env.production is host-side and was not read), so the default 300000 ms applies unless the host file overrides it; either way the probe follows the container's value. Verified by running the probe at 400 s and 1000 s marker age with default and 600000 ms poll |
| Restart behavior | Cron exits 1 after 5 consecutive failures (entrypoint test); compose `restart: unless-stopped` restarts it. An unhealthy healthcheck alone does NOT restart a container under plain compose, so a hung (not failing) loop is reported unhealthy but not self-healed; that gap is out of this lane's scope and not claimed fixed |
| Resource limits | grading-cron service limits unchanged: memory 256m, cpus 0.25 |
| Not done / reserved | No deploy, restart, provider change, data mutation or kill-switch change. The compose healthcheck only takes effect after a Griff-dispatched deploy. T1 approval (t1-approved label and pm-verdict/v1) is independent and pending |

## Summary

The grading cron now survives transient bookkeeping failures: it catches them, retries with bounded exponential backoff (5 consecutive failures; 1s, 2s, 4s, 8s, 30s cap), alerts through the existing ops callback within 5 s on exhaustion, rejects and exits 1 so the compose restart policy recreates it. Each successful cycle refreshes a liveness marker that the grading-cron healthcheck reads. Settlement and grading services are untouched.

## Verification

- Focused failure-injection suite: `pnpm exec tsx --test apps/api/src/grading-cron.test.ts` -> 23 tests, 23 pass, 0 fail (E1-E3).
- Mutation: removing the outer try/catch fails the 3 transient-recovery tests (E4).
- Static: `pnpm verify:static` exit 0 on the folded-test layout; `pnpm type-check` pass.
- Runtime (live DB): CI Writable DB proof against staging xskgrzbteyqdufktjrjx, run 42398274218 attempt 1, `pnpm test:db` exit 0, 9/9, receipt artifact utv2-1630-db-proof-receipt-42398274218-1. Generic DB smoke suite: it covers settlement idempotency and no-duplicate tests (UTV2-920, UTV2-996) but does not run the cron loop.
- Healthcheck probe exercised at 400 s and 1000 s marker age with default and 600000 ms poll, and with a missing marker.
- Not done, by design: no deploy, restart, provider change, data mutation or kill-switch change.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1837
