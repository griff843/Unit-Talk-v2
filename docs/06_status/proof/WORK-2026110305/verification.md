# PROOF: WORK-2026110305

MERGE_SHA: pending merge

Issue: WORK-2026110305
Tier: T1
Implementation SHA: baf1164999da78df5c218733b8d0db8435d8b4ff
Result: static verification passed, and exact-head writable staging proof passed in CI (`ci.yml` run 41682337207 at `4ed895e5460f7274f651607110872eec7a67f00d`). Real Discord delivery is NOT proven; see "Verification boundary".

## Assertions and proof boundaries

The API live suite seeds a run-namespaced capper and uses the real Database bundle and submission/release paths. It checks authorization, capper identity, pinned destination, validated/queued lifecycle and exactly one pending unclaimed official-picks outbox row before any fixture change. Track Only must persist no outbox. Removing the server allowlist must return 403 and persist no additional pick, preventing the step-2 outbox. That mutation is implemented but has not executed against staging locally.

The API suite stores the persisted delivery pick ID in its owned capper metadata. The worker reads that fixture and then the pick by primary ID, checking capper attribution before continuing. The contract-author ruling permits a test-fixture retarget only after asserting the row is pending and unclaimed; PATCH filters include row ID, pick ID, pending status and both null claim fields. This is a fixture step, not a production delivery operation. The official-picks claim path is not exercised.

Worker claim and confirm use the real database RPC path. The Discord adapter and its message ID are SIMULATED: no Discord API call or real Discord delivery is claimed. The suite asserts the owned switch blocks claiming, releases only that switch, then verifies one sent receipt with the pinned channel, queued-to-posted lifecycle, and an idle second cycle with adapter count still one and one receipt. Only the test-owned switch is cleaned up. No real target switch is touched.

The real ungoverned-target contract requires zero distribution.dispatch_* audit rows for this pick. Governed-target dispatch-ledger behavior is not proven here. Existing in-memory ledger tests cover it, and the production canary must evidence it. No target is remapped onto a governed target and no ledger row is fabricated. The halves run in separate processes to respect the prohibition on app-to-app imports.

## Verification

| Command | Measured result |
|---|---|
| pnpm verify | Exit 1: complete static stage passed, then writable guard refused host=127.0.0.1 / ref=unidentified. |
| pnpm verify:static, as invoked by pnpm verify | PASS: boundary, sync/alignment/automation checks, env, lint, type-check, build, full pnpm test, production migration tests, Smart Form verification and command verification. |
| pnpm exec tsx --test apps/api/src/t1-proof-work-2026103007-human-capper-delivery-live.test.ts apps/worker/src/t1-proof-work-2026103007-human-capper-delivery-live.test.ts | Exit 0: 2 tests, 0 pass, 0 fail, 2 skipped. This verifies loading only, not live behavior. |
| pnpm exec tsx --test apps/api/src/capper-delivery-authorization.test.ts apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts apps/worker/src/worker-runtime.test.ts | Exit 0: 162 tests passed; none skipped. Regression evidence only. |
| pnpm test:db | Exit 1: refused before DB access because target is not approved staging. |
| pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD | PASS; lifecycle-fsm matched. Mechanical check finds existing tracked WORK-2026100301 R2/R3/R4 artifacts; no new lane-specific shadow/fault execution is claimed. |
| git diff --check | PASS. No tests removed and no new any casts. |

Full static verification emitted existing expired wiring-baseline warnings. Optional Smart Form browser E2E did not run because UNIT_TALK_SMART_FORM_E2E is not set.

Local command logs: /tmp/work-2026110305-verify.log, /tmp/work-2026110305-test-db.log, /tmp/work-2026110305-runtime.log. Structured results and limits are retained in evidence.json.

ASSERTIONS:
- [x] An authorized human capper's delivery-eligible submission persists one pick attributed to that capper, with an authorized delivery decision, validated and queued lifecycle, and exactly one pending, unclaimed `discord:official-picks` outbox row carrying the pinned capper, channel and guild destination.
- [x] A Track Only submission by the same capper persists a pick and no outbox row.
- [x] With the server allowlist removed, the same delivery-eligible request returns 403 and persists no additional pick (the live mutation).
- [x] The worker honors the test-owned kill switch (no claim, no adapter call), then after release claims and confirms through the real atomic RPCs exactly once: one sent receipt on the pinned channel, one queued-to-posted lifecycle row, an idle second cycle with no new adapter call or receipt, and zero `distribution.dispatch_*` audit rows for the namespaced target.
- [ ] Real Discord delivery. Not proven here; see "Verification boundary".

EVIDENCE:
- Exact-head CI: `ci.yml` run 41682337207, attempt 1, at `4ed895e5460f7274f651607110872eec7a67f00d` (the `ops:merge-wrapper git-merge-main` sync of `34efcbe05` onto main `bb1947e31`). `verify` job 126087833993 succeeded. `Writable DB proof (staging only)` job 126078966205 succeeded against staging `xskgrzbteyqdufktjrjx`, with no `not ok` line anywhere in `pnpm test:t1-proof:live`.
- API suite: `ok 1 - WORK-2026103007 live staging: canonical authorization/release persists one outbox; Track Only and removed allowlist cannot enqueue`.
- Worker suite: `ok 1 - WORK-2026103007 live staging: test-fixture retarget, real atomic claim/confirm, exactly once and owned kill control with SIMULATED Discord adapter; no official-picks claim`.
- Disclosure: run 41671267309 at `313ae1e80` failed on the fixture idempotency collision described under "Rework at baseline 313ae1e80". Run 41678610020 at `34efcbe05` failed earlier in the chain, in the unrelated `t1-proof-utv2-1907-capper-attribution` suite (`listByLifecycleStates` statement timeout on staging), so this lane's suites did not run there. That timeout is a staging performance issue tracked outside this lane.
- Commits after `4ed895e54` touch only proof and model-routing files.

```text
ci.yml run 41682337207 attempt 1, head 4ed895e5460f7274f651607110872eec7a67f00d
job 126078966205 Writable DB proof (staging only): success
ok 1 - WORK-2026103007 live staging: canonical authorization/release persists one outbox; Track Only and removed allowlist cannot enqueue
ok 1 - WORK-2026103007 live staging: test-fixture retarget, real atomic claim/confirm, exactly once and owned kill control with SIMULATED Discord adapter; no official-picks claim
job 126087833993 verify: success
```

## Verification boundary

| Link | Status |
|---|---|
| Authorized capper -> canonical submission -> exactly one outbox row with correct destination | Proven on real staging Supabase (API suite, run 41682337207) |
| Track Only and removed allowlist -> no outbox row / 403 | Proven on staging |
| Worker claim/confirm, kill switch honored, exactly-once send, posted lifecycle, one receipt | Proven on staging with a SIMULATED Discord adapter and a test-fixture retargeted namespaced target, not `official-picks` |
| `official-picks` claim path and governed-target dispatch ledger | Not proven live; in-memory tests only |
| Real Discord message reaching a real channel | Not proven; only the private production canary can prove it, which needs Griff's separate delivery authorization |

A green run is not a readiness claim and does not mean Unit Talk can deliver to Discord.

## Review sequencing

PR #1826 is open. T1 merge requires Griff's `t1-approved` label and a `pm-verdict/v1` APPROVED comment at the exact head. This proof closeout (format fixes and recording the measured CI result) was written by Production Claude, the orchestrator. It changes no source or test file.

## Model routing

The wrapper's observed launch configuration is gpt-6.1-sol, effort medium; model-routing.json is wrapper-owned evidence and is preserved for wrapper refresh.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1826
PM approval, governed merge, finalization, and orchestration reconciliation remain pending.

## Rework at baseline 313ae1e80

Staging CI run [41671267309](https://github.com/griff843/Unit-Talk-v2/actions/runs/41671267309/job/126040614439) failed the API lookup with zero rows; the worker did not execute. Root cause: the preceding Track Only suite used the same selection/event identity under CI_FIXTURE_RUN_ID; idempotency excludes capper identity, so the submission returned the other suite's existing pick. This was a fixture collision, requiring no production code change.

The corrected fixture prefixes both participant names with WORK3007. A local experiment evaluated the actual fixture body functions and real computeSubmissionIdempotencyKey: the old keys matched and corrected keys differ (PASS; no DB access). Capper seed persistence is read back by primary ID. Both API picks and the worker pick are read by primary ID before attribution assertions; diagnostics include actual capper_id, status and metadata.capper. Only the fixture capper metadata carries the cross-process pick-ID handoff.

Rework type-check passed. Focused live tests load with two skips locally. test:db refuses the local loopback target before writes. Corrected exact-head staging proof and the live authorization mutation remain pending on existing PR #1826. The simulated Discord and governed-ledger limits above remain unchanged.

Rework final gates: `pnpm verify` exit 1 after the entire `verify:static` stage passed (lint, type-check, build, full tests, post-migration tests, Smart Form verification and command checks); the live stage refused loopback before writes. Separate final `pnpm type-check` passed. Focused live files: 2 skipped, 0 failed. `pnpm test:db`: staging guard refusal. R-level check and diff check: PASS. Existing expired wiring-baseline warnings and optional Smart Form browser E2E not-run notice persist. Logs: `/tmp/work-2026110305-rework-{verify,typecheck,focused,test-db}.log`. No new `any` casts or removed tests.
