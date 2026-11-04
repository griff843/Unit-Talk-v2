# WORK-2026110309 — submission idempotency evidence v1

MERGE_SHA: pending merge

## Verification

Status: INCOMPLETE — draft review candidate. No approval, merge, live DB proof or lane closeout is claimed.

ASSERTIONS:
- [x] Different cappers receive separate picks with canonical capper attribution.
- [x] Same-capper retries in the same mode return the original pick without new rows.
- [x] Both Track Only / delivery-eligible orders create immutable separate records.
- [x] Unscoped automated submissions preserve the six-field key byte-for-byte; board writer rerun dedupe passes (19/19).
- [x] Historical keys and existing picks are never rewritten. No legacy fallback: a scoped retry of a pre-change pick creates a new pick; later retries dedupe to that scoped pick.
- [x] Six behavior regressions fail on the unmodified origin/main service; seven issue tests pass after repair (one legacy invariant passes before and after).
- [x] Removing submitter fails cross-capper isolation; removing distribution mode fails both cross-mode orders.
- [x] UTV2-1672 / UTV2-1923 controller guards remain unmodified.
- [ ] OPEN BLOCKER verify-4: controller guard mutation-control fixture at apps/api/src/controllers/submit-pick-controller.test.ts:432 assumes old cross-mode collision; suite is 12 pass / 1 fail. It is not wired into any package script, so CI does not run it. PM SCOPE_OVERRIDE on the PR is required before editing this fixture. Per orchestrator ruling, neither controller nor its test was changed.
- [ ] Exact-head pnpm verify green: local staging identity gate refuses configured host before DB work.
- [ ] Exact-head Writable DB proof (staging only) CI job green with new suite reporting no skips.
- [ ] OPEN BLOCKER: packet requires evidence schema v1; current proof-binding-validator rejects v1 for pre-merge authoring (historical read-only). A governed contract reconciliation is needed; no runtime evidence is fabricated to satisfy the gate.
- [ ] Final merge SHA binding, Griff t1-approved label and exact-head pm-verdict/v1 APPROVED comment.

The tests named `WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks` and the reverse-order variant in apps/api/src/submission-service.test.ts:3598 exercise the actual controller and show both modes succeed with distinct picks. They snapshot the first pick and outbox before the second submission and compare afterward. New key isolation avoids the guards on normal cross-mode resubmission; the existing artificial guard fixture remains an explicit blocker above.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (packet: host=unparseable; observed locally: host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run through the staging-ci GitHub environment with CI_SUPABASE_* credentials. No local writable DB command passed the staging guard.

## Impact review

- Grading: apps/api/src/grading-service.ts:409,418 uses pick.id for settlement prefetch and grading, not picks.idempotency_key or a wager tuple.
- Member performance: apps/api/src/member-performance-service.ts:113-127,146,202,226-246 uses pick.id, capper_id, outbox pick_id and authorization capper identity. Separate canonical picks are independent records; there is no one-pick-per-wager assumption here.
- Outbox/delivery: packages/contracts/src/distribution.ts:36 builds pick.id:target:distribution keys, used by apps/api/src/distribution-service.ts:435-443. Separate picks have separate outbox identity; delivery authorization, kill switches and target policy are unchanged. Track Only remains gated.
- Authorization: apps/api/src/handlers/submit-pick.ts:201-203 pins authenticated capperId. Scoped hashing mirrors the persistence precedence in packages/db/src/pick-foreign-keys.ts:46-56 after the existing submittedBy capper pin in submission-service.ts. No authorization change.
- Only apps/api/src/submission-service.ts calls findPickByIdempotencyKey for canonical picks (lookup and race recovery). Consumers above require no behavioral changes or new consumer tests. Board writer dedupe is independently verified. Candidate scanner, alert agent and board writer unscoped key compatibility is directly asserted by the new legacy-key test.

## Staging suite

apps/api/src/t1-proof-work-2026110309-submission-idempotency-live.test.ts is registered in test:t1-proof:live and db-writer-classification.json. It checks CI=true, CI_FIXTURE_RUN_ID, HTTPS and exact staging hostname before privileged repository construction; uses two run-namespaced seeded cappers; reads picks, submissions, lifecycle, outbox and cappers by primary ID. Expected observations are six picks, two cappers and zero outbox rows; these are expectations, not measured live results. Fixture-only cleanup voids owned picks through the FSM and retains append-only audit history and namespaced capper fixtures. No delivery adapter or real delivery target is used.

## R-level policy

lifecycle-fsm requires R1/R2/R3/R4 (R5 advisory). Binding PM ruling accepts existing tracked artifacts/r2-determinism-WORK-2026100301.json and artifacts/shadow-report-WORK-2026100301.json for mechanical presence only; existing R4 fault artifact is checked by the R-level command. No artifacts/ file is added or changed. Historical artifacts are NOT evidence of this repair. Pre-commit HEAD-only R-level output is historical and cannot establish repair compliance; a post-commit check follows.

## Model routing

The existing model-routing.json is preserved: it contains wrapper-observed model gpt-6.1-sol and effort medium for attempt 2, including session identity, CLI version and usage. Attempt 3 routing observation must be persisted by the outer wrapper; this executor does not invent new session provenance.

## Recorded command evidence

Prior-attempt results below are preserved from the resumed executor's measured logs. They are pre-review-commit observations, not exact-head CI proof. Regression-before used the unmodified origin/main service; regression-after restored the repaired service. Mutation-submitter removes submitter from the scoped suffix; mutation-mode removes distribution mode. The implementation was restored after both controls.

EVIDENCE: board
```text
TAP version 13
# Subtest: empty board run returns zeros
ok 1 - empty board run returns zeros
  ---
  duration_ms: 6.972999
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:35.866Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"0d1d5702-860a-48de-b225-3cb6e474fccf","pickId":"ef8bbb42-ca28-4fd4-9ac6-51d4eed6f60f","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: writes pick for a board candidate and links pick_id
ok 2 - writes pick for a board candidate and links pick_id
  ---
  duration_ms: 28.931404
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:35.876Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"73ea967f-4583-47c8-814c-071564416630","pickId":"6f68e362-e205-4cba-8c0d-9ba41dfdc52d","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: idempotent: second run skips already-linked candidates
ok 3 - idempotent: second run skips already-linked candidates
  ---
  duration_ms: 4.515732
  type: 'test'
  ...
# Subtest: skips board row with no matching candidate
ok 4 - skips board row with no matching candidate
  ---
  duration_ms: 1.144284
  type: 'test'
  ...
# Subtest: skips candidate with invalid odds
ok 5 - skips candidate with invalid odds
  ---
  duration_ms: 1.187235
  type: 'test'
  ...
# Subtest: stale board snapshot fails closed before any pick write
ok 6 - stale board snapshot fails closed before any pick write
  ---
  duration_ms: 1.291118
  type: 'test'
  ...
# Subtest: missing board market snapshot fails closed before any pick write
ok 7 - missing board market snapshot fails closed before any pick write
  ---
  duration_ms: 1.315417
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:35.887Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"89ed24d1-6526-4d0e-841f-bd4fa48e4675","pickId":"1ae42a79-52d8-433b-b322-89a94b26f35f","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: source attribution is board-construction on every written pick
ok 8 - source attribution is board-construction on every written pick
  ---
  duration_ms: 6.391141
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.182Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"b59033a0-4a7b-4735-bb7e-fe8f5ca85462","pickId":"1754cc3f-3dee-4466-b3ec-78d49efc23d7","idempotencyKey":"4058b2275d16f20558815b75d75f57c3","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: board writer normalizes event and participant identity into created picks
ok 9 - board writer normalizes event and participant identity into created picks
  ---
  duration_ms: 299.668735
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.193Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"823fb7d5-4376-4169-af87-0286b76a522d","pickId":"fc353abd-ce62-433e-b898-19fe10181e57","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:59:36.197Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"ec2b2c2d-97df-4f3f-b73a-abf895efbdf1","pickId":"50ca67cd-0179-452d-9b31-980d88b768ed","idempotencyKey":"90166ff5d0d45b4f26e474f84ba97e49","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: per-row linking: first candidate linked before second candidate is processed
ok 10 - per-row linking: first candidate linked before second candidate is processed
  ---
  duration_ms: 9.251624
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.201Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"271578fd-7af0-424a-b294-3fe5ce4164b5","pickId":"6b83cf93-19fe-4d9a-81a8-15661e178f95","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:59:36.203Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"3fff55cc-ad20-4350-a226-67040d902756","pickId":"5f9fa13d-6ac4-416a-a925-fa93321de462","idempotencyKey":"90166ff5d0d45b4f26e474f84ba97e49","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: partial-success rerun: unlinked candidate retried, no duplicate created
ok 11 - partial-success rerun: unlinked candidate retried, no duplicate created
  ---
  duration_ms: 6.424043
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.208Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"3b1ffb72-5d3a-4d68-b805-251fc39691d7","pickId":"216d9dd8-bad3-4617-87ad-50a2b589580d","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:59:36.212Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"9c77c7f6-586e-4145-a29c-723c7b41d9ad","pickId":"40872400-774b-4bd4-8d1c-593462dcd350","idempotencyKey":"90166ff5d0d45b4f26e474f84ba97e49","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: shadow_mode correctness: only cleared on successfully linked candidates
ok 12 - shadow_mode correctness: only cleared on successfully linked candidates
  ---
  duration_ms: 7.878731
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.215Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"c14a323f-742d-4f8c-83da-dc8ac3d75995","pickId":"dccb84f4-fb2e-42c5-bf03-ac6186aa45b8","idempotencyKey":"84630364beb6aa1f42fb9cddf8826a9d","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: audit record contains actor, boardRunId, written/skipped/errors
ok 13 - audit record contains actor, boardRunId, written/skipped/errors
  ---
  duration_ms: 3.155708
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.218Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"e9a4ae63-113a-4512-9c1d-004fd0411996","pickId":"e5989afd-ed69-47b2-8ea8-4cee13ecb24c","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: actor defaults to system:board-construction when not provided
ok 14 - actor defaults to system:board-construction when not provided
  ---
  duration_ms: 3.303215
  type: 'test'
  ...
# Subtest: candidate with non-finite odds is counted in skipped, not errors or written
ok 15 - candidate with non-finite odds is counted in skipped, not errors or written
  ---
  duration_ms: 0.979079
  type: 'test'
  ...
# Subtest: scheduler enablement follows the syndicate machine runtime when board writing is not separately forced on
ok 16 - scheduler enablement follows the syndicate machine runtime when board writing is not separately forced on
  ---
  duration_ms: 0.185177
  type: 'test'
  ...
# Subtest: scheduler enablement can be forced on independently of the broader syndicate machine gate
ok 17 - scheduler enablement can be forced on independently of the broader syndicate machine gate
  ---
  duration_ms: 0.069578
  type: 'test'
  ...
# {"timestamp":"2026-11-04T12:59:36.223Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"50495ee5-333a-453a-9719-ebad955beb3c","pickId":"b1a5f6c5-b7bd-4b69-af79-c5b494b9697c","idempotencyKey":"6962f2625022c82c681b2ef0744c4320","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: scheduler flags grant execution only and cannot release an automated board pick
ok 18 - scheduler flags grant execution only and cannot release an automated board pick
  ---
  duration_ms: 6.568291
  type: 'test'
  ...
# Subtest: REGRESSION UTV2-1611: board event start time is never fabricated from a date at midnight
ok 19 - REGRESSION UTV2-1611: board event start time is never fabricated from a date at midnight
  ---
  duration_ms: 0.257729
  type: 'test'
  ...
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1778.974544
```

EVIDENCE: controller
```text
TAP version 13
# {"timestamp":"2026-11-04T13:02:26.544Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"54d46257-e3fe-48ea-b4f1-9b979876a137","pickId":"c40780bc-e5f8-4e47-8d06-a50b28f6f8b7","idempotencyKey":"790c9118f5f7871b3d687415126ca393","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: system-pick-scanner lands in awaiting_approval (governance brake)
ok 1 - submit-pick-controller: system-pick-scanner lands in awaiting_approval (governance brake)
  ---
  duration_ms: 23.04267
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.555Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"ca330e81-0e12-4618-8080-afc80b6aae48","pickId":"acc5941b-baee-4f27-8ba9-6b987ad05acf","idempotencyKey":"1bbb9ac2ff96d01fda1c85e76ae83e09","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: alert-agent lands in awaiting_approval (governance brake)
ok 2 - submit-pick-controller: alert-agent lands in awaiting_approval (governance brake)
  ---
  duration_ms: 4.146553
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.559Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"9e420dfd-226e-40a8-aaac-ae6b9cd78da9","pickId":"9f6e6eda-3067-4ae6-ad3b-76a1abe5cb26","idempotencyKey":"32826f901b04b531f6b898f9c5708f7c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: board-construction IS braked (UTV2-1611)
ok 3 - submit-pick-controller: board-construction IS braked (UTV2-1611)
  ---
  duration_ms: 4.520001
  type: 'test'
  ...
# Subtest: submit-pick-controller: board-construction without market evidence fails closed (UTV2-1611)
ok 4 - submit-pick-controller: board-construction without market evidence fails closed (UTV2-1611)
  ---
  duration_ms: 1.517847
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.568Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"23fd8219-eb95-445b-bd84-548f39211ce6","pickId":"54040d3b-db36-47f9-a2bd-b95d0b7f4f8a","idempotencyKey":"769fe40bd197320a36594dc93a4ae2ca","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: smart-form path is NOT braked (regression guard)
ok 5 - submit-pick-controller: smart-form path is NOT braked (regression guard)
  ---
  duration_ms: 6.860532
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.573Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"2a3d4d5f-6971-4be4-a793-f431af9d230f","pickId":"bcc19476-0727-4b9b-8951-3090c2f8b772","idempotencyKey":"1dcee48ac95954198ae9b01aedf89ec3","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: track-only smart-form pick persists without outbox work
ok 6 - submit-pick-controller: track-only smart-form pick persists without outbox work
  ---
  duration_ms: 4.735838
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.577Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"9a1486f7-63b0-4672-a323-116e6402f701","pickId":"b17dc58e-8048-490e-a49d-ae0582bc6c51","idempotencyKey":"e7104031bd0b2d52999c9075dfc33ed9","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: api source is NOT braked (human path preserved)
ok 7 - submit-pick-controller: api source is NOT braked (human path preserved)
  ---
  duration_ms: 3.853974
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.582Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"75ef297c-eca3-4331-ae47-cd978097513e","pickId":"65aa48ad-c295-4492-95f9-193b47ea62bc","idempotencyKey":"515c07167f5b3779461aa3055d41faf1","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: discord-bot source is NOT braked (human-relayed path)
ok 8 - submit-pick-controller: discord-bot source is NOT braked (human-relayed path)
  ---
  duration_ms: 4.335152
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.592Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"e06879db-aad7-4f4b-9f79-d1843f8bf795","pickId":"a0dca7e1-f579-4873-8de7-ba2e0668603c","idempotencyKey":"e7104031bd0b2d52999c9075dfc33ed9","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: submit-pick-controller: enqueue failure writes operator-visible zombie pick alert run
ok 9 - submit-pick-controller: enqueue failure writes operator-visible zombie pick alert run
  ---
  duration_ms: 14.986939
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.625Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"087146b7-3ad0-4374-987e-3e9c8eb59a24","pickId":"2cf1161d-e906-4b0d-ab89-2ee2015cf71b","idempotencyKey":"1b81be265761da12a1a2137c92eaa2c9","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: mutation control: removing SMART_FORM_RELATIONSHIP_GUARD admits an unverifiable canonical resolution
ok 10 - mutation control: removing SMART_FORM_RELATIONSHIP_GUARD admits an unverifiable canonical resolution
  ---
  duration_ms: 29.023707
  type: 'test'
  ...
# {"timestamp":"2026-11-04T13:02:26.631Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"4c1e5961-4cfc-4845-9fef-9e42e9440124","pickId":"83af32f4-783c-4dc5-9d80-92347f235df4","idempotencyKey":"f996ccbc9cc66d0930f6bbea4fb9658b","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T13:02:26.635Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"d5f7b6eb-b128-4b03-8efe-f9766a75f8b3","pickId":"1b421f95-d106-4b00-846f-928cf1d17043","idempotencyKey":"663948382519513c0008c9ae4c67a5d6","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: mutation control: removing TRACK_ONLY_REQUEST_INTEGRITY_GUARD answers a Track Only request with a delivery-eligible pick
not ok 11 - mutation control: removing TRACK_ONLY_REQUEST_INTEGRITY_GUARD answers a Track Only request with a delivery-eligible pick
  ---
  duration_ms: 13.597
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/controllers/submit-pick-controller.test.ts:1:10453'
  failureType: 'testCodeFailure'
  error: |-
    baseline must refuse the colliding Track Only request
    + actual - expected

    + 'response'
    - 'error'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'error'
  actual: 'response'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/controllers/submit-pick-controller.test.ts:432:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# {"timestamp":"2026-11-04T13:02:26.645Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"7f051702-9141-4664-8d83-06618109460f","pickId":"5e8bf843-b67e-415b-a0d7-f544bc66ebad","idempotencyKey":"1dcee48ac95954198ae9b01aedf89ec3","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: UTV2-1842: a manual coverage-gap Track Only pick persists while the events catalog holds only other events
ok 12 - UTV2-1842: a manual coverage-gap Track Only pick persists while the events catalog holds only other events
  ---
  duration_ms: 5.366301
  type: 'test'
  ...
# Subtest: UTV2-1842: a smart-form pick that claims a canonical event it cannot name is still refused
ok 13 - UTV2-1842: a smart-form pick that claims a canonical event it cannot name is still refused
  ---
  duration_ms: 1.293258
  type: 'test'
  ...
1..13
# tests 13
# suites 0
# pass 12
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1512.132629
```

EVIDENCE: db
```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

EVIDENCE: focused
```text
# fail 0
[terminal output excerpt]
  ...
# Subtest: WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
ok 104 - WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
  ---
  duration_ms: 3.830118
  type: 'test'
  ...
# Subtest: WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
ok 105 - WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
  ---
  duration_ms: 0.369463
  type: 'test'
  ...
# Subtest: WORK0309 live staging: capper isolation, retry dedupe and immutable Track Only in both orders
ok 106 - WORK0309 live staging: capper isolation, retry dedupe and immutable Track Only in both orders # SKIP requires staging-ci and CI_FIXTURE_RUN_ID; no local DB writes
  ---
  duration_ms: 1.186595
  type: 'test'
  ...
1..106
# tests 106
# suites 0
# pass 105
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 1993.390792
```

EVIDENCE: focused-resume
```text
# fail 0
[terminal output excerpt]
  ...
# Subtest: WORK0309 scope encoding cannot alias identities containing separators
ok 103 - WORK0309 scope encoding cannot alias identities containing separators
  ---
  duration_ms: 0.56532
  type: 'test'
  ...
# Subtest: WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
ok 104 - WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
  ---
  duration_ms: 5.404563
  type: 'test'
  ...
# Subtest: WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
ok 105 - WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
  ---
  duration_ms: 0.835713
  type: 'test'
  ...
1..105
# tests 105
# suites 0
# pass 105
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3198.872734
```

EVIDENCE: mutation-mode
```text
TAP version 13
# {"timestamp":"2026-11-04T12:58:13.264Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"4dee6723-5b01-4b36-bb6d-f0667240830f","pickId":"29a7f9ce-b544-4f5a-906d-e18c1731d2b0","idempotencyKey":"92acd0f2a7c020d0f4c31ac0309f9a38","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:58:13.278Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"f1b27ef9-f8fe-4dbd-a10c-ddb395533fe2","pickId":"939273be-f502-4148-a3fb-c70eb13892b7","idempotencyKey":"92acd0f2a7c020d0f4c31ac0309f9a38","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
not ok 1 - WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 23.165063
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:80456'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    '29a7f9ce-b544-4f5a-906d-e18c1731d2b0'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '29a7f9ce-b544-4f5a-906d-e18c1731d2b0'
  actual: '29a7f9ce-b544-4f5a-906d-e18c1731d2b0'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3605:12)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
not ok 2 - WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 2.247738
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:80456'
  failureType: 'testCodeFailure'
  error: 'This submission matches an existing pick that is not Track Only; it cannot be reused for a Track Only submission.'
  code: 'TRACK_ONLY_CONFLICT'
  name: 'ApiError'
  stack: |-
    submitPickController (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/controllers/submit-pick-controller.ts:117:11)
    async TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3602:20)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1212.795388
```

EVIDENCE: mutation-submitter
```text
TAP version 13
# {"timestamp":"2026-11-04T12:58:11.169Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"5cd730d1-fbd5-42ae-bb59-8bfb9088c10f","pickId":"d20a8a13-e815-4816-a614-9f44dd07f3d4","idempotencyKey":"ac8e0315da7413eba711769a46c7b629","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
not ok 1 - WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
  ---
  duration_ms: 22.221187
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:79379'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    'd20a8a13-e815-4816-a614-9f44dd07f3d4'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'd20a8a13-e815-4816-a614-9f44dd07f3d4'
  actual: 'd20a8a13-e815-4816-a614-9f44dd07f3d4'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3577:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1633.786394
```

EVIDENCE: regression-after
```text
TAP version 13
# {"timestamp":"2026-11-04T12:57:50.865Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"95be963c-273c-4946-9516-b998780404e7","pickId":"8d3b2c9c-f1d6-498c-a5d9-404401427c53","idempotencyKey":"fceb731eb69ad7cae340056b94e0158a","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.873Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"988696f0-0589-4b03-82e1-5711479ca0ca","pickId":"0d6848cf-fc8b-4c0d-b732-163d22438245","idempotencyKey":"09019b7aff2772fc902bd306114ca839","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.880Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"2fe97b12-75e6-4c2e-929f-cfacd679a615","pickId":"9fb156ec-4a88-4ee3-a35c-830abe8abdcc","idempotencyKey":"5676fc634cb8eb6581e5fd29adf8802c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.881Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"da1c694c-558a-4fcc-9659-e451cdcc1936","pickId":"0f6b32e9-cba1-4547-8213-418d065e541b","idempotencyKey":"a0206ee0bee5852bcd1a4edb6c95dde4","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.884Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"38e979f3-f10b-4d98-b7e0-85128d821ade","pickId":"760dda06-f22c-4e79-823e-6efa7e73ae79","idempotencyKey":"a0206ee0bee5852bcd1a4edb6c95dde4","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.885Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"3908d456-521c-4d0a-9a9c-f4bf161c4d1c","pickId":"741bd20a-ffba-452f-b48d-ef7da69aceb8","idempotencyKey":"5676fc634cb8eb6581e5fd29adf8802c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.887Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"c02fcd10-627a-4dfa-a938-658397674126","pickId":"a5fb5021-c6fd-406a-825c-fee87ac37268","idempotencyKey":"f49057eb20c120ca9841e18002f6d4ef","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.888Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"cf41b6a7-c1db-4569-bdf2-02e0133801aa","pickId":"12f2d8ea-1a26-42a1-b1bc-d599e0189451","idempotencyKey":"dba22c9b1b4b3f4b646305388a45b295","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.890Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"1217592e-ef0a-4de6-9239-b4b6e141f839","pickId":"36b0f7fd-0008-470c-89e5-917825e75db9","idempotencyKey":"2ce867845f85bf7b5e85760c0187a31f","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.891Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"85af1a73-f5ce-43ba-8845-aabedb5fdaca","pickId":"b3a9acc2-f697-4775-b0c9-23e3a518aa8f","idempotencyKey":"f897ddab713268bb306ba19d80c6caef","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.892Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"73259fc7-d8cb-4991-98c3-7e7d78c4fa9d","pickId":"7e4870e3-3913-4b21-b606-f18905e2683b","idempotencyKey":"d95310dff7a12d065afd16e1cfe44191","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.895Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"0c9b1d41-436d-4e95-897b-981b924e7b2f","pickId":"fcc56ada-9fc6-4bfe-9cab-66cfff3c8039","idempotencyKey":"fceb731eb69ad7cae340056b94e0158a","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:57:50.895Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"b9f3cc52-c800-4cbc-a844-9e4852422c34","pickId":"7f88104a-04be-46a0-b089-21bd4eb9ca1d","idempotencyKey":"fceb731eb69ad7cae340056b94e0158a","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
ok 1 - WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
  ---
  duration_ms: 19.662416
  type: 'test'
  ...
# Subtest: WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
ok 2 - WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 5.047114
  type: 'test'
  ...
# Subtest: WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
ok 3 - WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 3.472717
  type: 'test'
  ...
# Subtest: WORK0309 attribution precedence matches persistence, including materialization capper pin and metadata strings
ok 4 - WORK0309 attribution precedence matches persistence, including materialization capper pin and metadata strings
  ---
  duration_ms: 6.808796
  type: 'test'
  ...
# Subtest: WORK0309 scope encoding cannot alias identities containing separators
ok 5 - WORK0309 scope encoding cannot alias identities containing separators
  ---
  duration_ms: 0.354079
  type: 'test'
  ...
# Subtest: WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
ok 6 - WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
  ---
  duration_ms: 2.504576
  type: 'test'
  ...
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1445.460049
```

EVIDENCE: regression-before
```text
TAP version 13
# {"timestamp":"2026-11-04T12:58:08.530Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"b61a4907-02fc-4a61-a3b3-9da6d1ba7b3b","pickId":"1d6241fb-cb42-4227-af04-bc7dd3273e68","idempotencyKey":"0b8f9b0ec6ac027f3d5a06ba41f96c6c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:58:08.547Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"358f1a13-8320-4898-919e-fe27d026c58e","pickId":"fbc3a634-db6d-4649-b23e-34c45554b4cd","idempotencyKey":"0b8f9b0ec6ac027f3d5a06ba41f96c6c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:58:08.552Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"52ff72dc-70fb-4251-a93a-f2f9cf628c27","pickId":"37e091f7-4e56-464e-abed-3be152ab25ec","idempotencyKey":"0b8f9b0ec6ac027f3d5a06ba41f96c6c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:58:08.554Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"56e99ca4-3145-4f67-9075-6681789ac4f8","pickId":"844b55af-d06f-4ee9-8cc2-af7188aa8958","idempotencyKey":"0b8f9b0ec6ac027f3d5a06ba41f96c6c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# {"timestamp":"2026-11-04T12:58:08.558Z","level":"warn","service":"api","message":"submission atomic write fell back to sequential persistence","component":"submission-service","flow":"processSubmission","reason":"in_memory_sentinel","fallbackMode":"sequential","submissionId":"51de350d-c703-4987-94dc-d417654cb869","pickId":"711a0991-6db5-4c14-8138-782742b4dfa9","idempotencyKey":"0b8f9b0ec6ac027f3d5a06ba41f96c6c","errorName":"Error","errorMessage":"processSubmissionAtomic is not supported in InMemory mode. Use the sequential path."}
# Subtest: WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
not ok 1 - WORK0309 cross-capper: identical wagers create separate attributed picks; same-capper retry creates no rows
  ---
  duration_ms: 21.136131
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:79379'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    '1d6241fb-cb42-4227-af04-bc7dd3273e68'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '1d6241fb-cb42-4227-af04-bc7dd3273e68'
  actual: '1d6241fb-cb42-4227-af04-bc7dd3273e68'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3577:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
not ok 2 - WORK0309 distribution isolation: track-only then delivery-eligible bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 5.421604
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:80456'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    'fbc3a634-db6d-4649-b23e-34c45554b4cd'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'fbc3a634-db6d-4649-b23e-34c45554b4cd'
  actual: 'fbc3a634-db6d-4649-b23e-34c45554b4cd'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3605:12)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
not ok 3 - WORK0309 distribution isolation: delivery-eligible then track-only bypasses conflict guards with separate immutable picks
  ---
  duration_ms: 2.526081
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:80456'
  failureType: 'testCodeFailure'
  error: 'This submission matches an existing pick that is not Track Only; it cannot be reused for a Track Only submission.'
  code: 'TRACK_ONLY_CONFLICT'
  name: 'ApiError'
  stack: |-
    submitPickController (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/controllers/submit-pick-controller.ts:117:11)
    async TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3602:20)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: WORK0309 attribution precedence matches persistence, including materialization capper pin and metadata strings
not ok 4 - WORK0309 attribution precedence matches persistence, including materialization capper pin and metadata strings
  ---
  duration_ms: 3.065497
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:81657'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected

    + 'payload'
    - 'capper'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'capper'
  actual: 'payload'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3628:12)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: WORK0309 scope encoding cannot alias identities containing separators
not ok 5 - WORK0309 scope encoding cannot alias identities containing separators
  ---
  duration_ms: 0.324536
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:82478'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    '0b8f9b0ec6ac027f3d5a06ba41f96c6c'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '0b8f9b0ec6ac027f3d5a06ba41f96c6c'
  actual: '0b8f9b0ec6ac027f3d5a06ba41f96c6c'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3636:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
not ok 6 - WORK0309 historical scoped retry creates a new pick without rewriting the legacy row or key
  ---
  duration_ms: 2.446777
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:1:82763'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be strictly unequal to:

    '711a0991-6db5-4c14-8138-782742b4dfa9'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '711a0991-6db5-4c14-8138-782742b4dfa9'
  actual: '711a0991-6db5-4c14-8138-782742b4dfa9'
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/api/src/submission-service.test.ts:3649:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
ok 7 - WORK0309 legacy producers retain the exact six-field key bytes without submitter or mode
  ---
  duration_ms: 0.411316
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 1
# fail 6
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1261.735572
```

EVIDENCE: rlevel
```text
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

EVIDENCE: static-resume
```text
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
[terminal output excerpt]
# Subtest: retry: an ambiguous attempt refuses without an operator attestation and leaves the row alone
ok 16 - retry: an ambiguous attempt refuses without an operator attestation and leaves the row alone
  ---
  duration_ms: 0.909463
  type: 'test'
  ...
# Subtest: retry: confirmedNotDelivered records the reconciliation BEFORE resetting the row
ok 17 - retry: confirmedNotDelivered records the reconciliation BEFORE resetting the row
  ---
  duration_ms: 1.133012
  type: 'test'
  ...
# Subtest: retry: an unreadable ledger fails closed with 503
ok 18 - retry: an unreadable ledger fails closed with 503
  ---
  duration_ms: 0.867461
  type: 'test'
  ...
1..18
# tests 18
# suites 0
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1527.93833
TAP version 13
```

EVIDENCE: tsc
```text
(no stdout/stderr; successful direct tsc -b recorded in previous executor checkpoint)
```

EVIDENCE: typecheck
```text
apps/api/src/submission-service.ts(102,22): error TS2339: Property 'submittedBy' does not exist on type '{ capper?: string; }'.
apps/api/src/submission-service.ts(102,58): error TS2339: Property 'submittedBy' does not exist on type '{ capper?: string; }'.
apps/api/src/submission-service.ts(104,44): error TS2339: Property 'distributionMode' does not exist on type '{ capper?: string; }'.
apps/api/src/submission-service.ts(105,16): error TS2339: Property 'distributionMode' does not exist on type '{ capper?: string; }'.
```

EVIDENCE: verify
```text
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# [assert-staging] REFUSED: target is CANONICAL PRODUCTION zfzdnfwdarxucxtaojxm. Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
# fail 0
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
[terminal output excerpt]
  ---
  duration_ms: 0.161409
  type: 'test'
  ...
# Subtest: only QA with a missing explicit identity is blocked by the QA safeguard
ok 153 - only QA with a missing explicit identity is blocked by the QA safeguard
  ---
  duration_ms: 0.196355
  type: 'test'
  ...
1..153
# tests 227
# suites 23
# pass 227
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3100.050606
smart-form e2e: not run (UNIT_TALK_SMART_FORM_E2E is not set).
Set UNIT_TALK_SMART_FORM_E2E=1 to run it. It requires a Playwright browser:
  pnpm exec playwright install chromium --with-deps
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope/apps/discord-bot/command-manifest.json
[check-migration-versions] 139 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 138 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

EVIDENCE: rlevel-repair
```text
Verdict: PASS
Changed files: 10
Rules matched: lifecycle-fsm
```

EVIDENCE: db-resume
```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

EVIDENCE: proof-validator (initial check; missing top-level MERGE_SHA row subsequently restored)
```text
{
  "schema_version": 1,
  "gate": "proof-binding-versioned",
  "issue_id": "WORK-2026110309",
  "verified_source_sha": "",
  "resolved_evidence_commit_sha": "(unresolved)",
  "resolved_current_pr_head_sha": "c6ada223c9d558765301cb986428c7262c23daf7",
  "placeholder_fields_resolved": false,
  "violations": [
    "schema_version: schema-v1 evidence is historical read-only and cannot pass a pre-merge authoring gate",
    "verification.md must contain exactly one top-level MERGE_SHA: row (found 0)"
  ],
  "ok": false
}
```

## Merge SHA Binding

Merge SHA: pending merge
Execution binding: final candidate identity is the Git commit containing this bundle; exact-head CI and authoritative post-merge binding remain pending. No branch SHA is presented as merge authority.
PR: pending draft creation
