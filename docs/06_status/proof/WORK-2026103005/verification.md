# PROOF: WORK-2026103005

MERGE_SHA: 2c52ca206c2c8c1fc570ef23f2cb6760084ebf6a

## Current PM proof repair — supersedes the historical CI status below

Current verified source anchor: `54c0e74320949b8b589f2c969f250632ee1ff74c`. Runtime product code is unchanged from the reviewed a03b649840b5a095dfe193ed1fac81ac15d4da3d. This source adds only two staging proof cases and an exact staging-origin guard in the existing live suite. Fresh exact-head CI remains required; earlier receipts do not prove these new cases.

PM review 6544069205 requires live proof for the necessary audit-release outbox pin. Production Claude authorized the supporting live test file in 6544120372 and corrected the expected pin location in 6544124518: outbox payload.deliveryDestination.audience is pinned here; pick metadata is not newly pinned by this lane. The original immutable lock is preserved. Final-head scope-override/v1 and independent T1 approval remain required and are coordinated by Claude.

The two new cases submit through handleSubmitPick using createDatabaseRepositoryBundle, read the actual pick and outbox from staging, assert exact outbox destination/audience and canonical identity, and run filterMemberVisibleDeliveryPicks with the real outbox repository. Staff-canary must be excluded; members must be retained. They create no receipt, delivery intent or Discord call. No kill-switch read/write is added.

Current local evidence:

- API type-check and DB writer inventory: PASS.
- Direct new live test invocation: two safe local skips because no hosted staging credentials are configured. This is not live proof. CI_FIXTURE_RUN_ID requires execution and fails rather than skipping when credentials are missing.
- Removing only the audit release audience pin caused the existing real-release InMemory test to fail on the missing staff-canary field. Byte restoration made all three focused authorization tests pass. This mutation was local InMemory evidence, not a live staging mutation. See mutation-summary.md.
- Full local pnpm verify exited 1: lint/type-check/build passed, then test:ops recorded 3727 passes, 2 failures and 10 skips out of 3739 tests. The failures were an already-existing shared test Git branch in codex-receive.test.ts and signal timing in verify-semaphore.test.ts. Both direct isolated reruns passed (1/1 each). No unrelated tooling fix or manual branch cleanup was made. Log: /tmp/work3005-pm-repair-verify.log. This is not a local full-gate PASS.
- Direct pnpm test:db exited 1 at the exact staging guard for loopback, without running writable tests. Fresh exact-head CI and execution of both new staging cases remain required. No production acceptance is claimed.

All earlier CI receipts and validator results below are retained as historical evidence only. Current acceptance requires the new head, including Proof Coverage Guard and actual execution of both new staging cases.

ASSERTIONS:

- [x] Private, unknown and mismatched audience pins are excluded from the in-scope member readers; legacy absent audiences remain members.
- [x] Outbox audience is pinned at release. Canonical pick records, Track Only controls and private per-pick recap destination are preserved.
- [x] Every implemented reader class kills the shared-predicate mutant. Insert-time pick pinning and public previews remain the separately approved successor scope.

EVIDENCE:

Actual final focused TAP summary from /tmp/work3005-final-focused.log:

```text
# tests 236
# suites 0
# pass 236
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

CI run 41116986496 attempt 2 passed verify and staging at the prior proof head fef4307850b6f34e45034be6ee4bdce09aaf69c7. Downloaded receipt utv2-1630-db-proof-receipt-41116986496-2 records pnpm test:db exit 0, 9 passed, 0 failed/skipped on approved staging xskgrzbteyqdufktjrjx. This checklist/fence-only repair leaves source unchanged and requires fresh exact-head CI before rebinding the executor result.

The rebindable anchor above intentionally remains pending before merge. Execution identity is the verified source SHA below; supported closeout will bind the actual merge SHA.

Status: refreshed source verification passed in CI; subsequent proof-only head CI and T1 PM review pending.

## Verification

Verified source candidate: `654b73b98e8d1a7481cebaf824af5c380d5c0e59`, the last non-proof commit after central main refresh. Product source remains `916228ed77abdfc05f49549148f2e22818786f78`; intervening main changes are docs/workflows and their governance tests, with no product-code delta. Production Claude authorized this reconciliation in comments 6533949804, 6534095737 and 6534488275.

- Exact-source [CI run 41133081686, attempt 1](https://github.com/griff843/Unit-Talk-v2/actions/runs/41133081686/attempts/1): **PASS** at run head 654b73b98e8d1a7481cebaf824af5c380d5c0e59. [Writable DB job 124330967074](https://github.com/griff843/Unit-Talk-v2/actions/runs/41133081686/job/124330967074) and [verify job 124335579333](https://github.com/griff843/Unit-Talk-v2/actions/runs/41133081686/job/124335579333) both passed. Downloaded artifact utv2-1630-db-proof-receipt-41133081686-1 records pnpm test:db exit 0, 9 passed, 0 failed/skipped on approved staging xskgrzbteyqdufktjrjx. Receipt tested PR merge ref e1fed7c5f7d098a1b615dbd07c7237d3294ac236, distinct from the source anchor. This subsequent proof-only commit still requires fresh candidate-head CI; no source receipt is substituted for that gate.

- Final direct focused suite: 236 passed, 0 failed, 0 skipped, across capper-delivery-authorization, member-picks, member-performance-service, member-performance-routes, recap-service and grading-service test files.
- Current new audience behavior tests: 11 passed, 0 failed, using `pnpm exec tsx --test --test-name-pattern=WORK-2026103005` on capper-delivery-authorization, member-picks, member-performance-service, recap-service and grading-service test files. These execute real in-memory route/service behavior; no production persistence or Discord delivery is implied.
- `pnpm verify`: all static stages passed (lint, type-check, build, full repository tests and static contract checks). The full command exited 1 at its writable staging-target guard because local host is loopback. This is not a green full gate; exact-head CI staging verification is required. Genuine local output is retained at /tmp/work3005-verify.log.
- Direct `pnpm test:db`: exited 1 at the staging-target guard. Local host 127.0.0.1 cannot identify approved staging project xskgrzbteyqdufktjrjx, so no writable DB test ran locally. Exact-head CI staging proof is required; local environment must never be pointed at production for writes.
- R-level check against origin/main and source HEAD: PASS, no matched artifact rules.
- `git diff --check`: PASS.
- Candidate `6c15a3d165883de749ab26a8ae48454cfaa05a18` passed both `verify` and staging database proof in CI run [41110318076](https://github.com/griff843/Unit-Talk-v2/actions/runs/41110318076). The staging receipt records exit 0 and 9 tests passed without skips on xskgrzbteyqdufktjrjx. This later proof-only section/anchor repair needs fresh candidate-head CI; the source commit remains unchanged.
- Local `evaluateCloseEligibilityPreflight` after the section/anchor repair: eligible true, zero blocking findings. Proof binding validator also passes.
- Predicate mutation: changing only the shared reader's staff-canary interpretation to members caused eight behavior failures, independently including member picks, generic picks, settlements, performance service, authenticated bot stats, authenticated bot leaderboard and aggregate recap. Restoring exact original source made all 11 new behavior tests pass. See mutation-summary.md; no mutant was committed.

## Remaining acceptance

P2 pagination finding 4428142176 is **reported, split to WORK-2026103023** by central comment 6533949804. Filtering after a repository limit can under-fill a member feed; it does not expose private rows. Central accepts this for the single-pick canary, discloses at most one missing legitimate row per page, and requires the bounded repository/read correction before any canary expansion. No pagination implementation or scope widening was performed in this lane.

Production Claude's #1811 comment 6530796692 moves the persisted pick pin to WORK-2026103021 Part B at submission insert time and removes it from this lane's remaining acceptance. Public previews/score readers are also separately assigned there. No production-canary readiness or exhaustive anonymous isolation is claimed until that successor lands. This lane's local implementation and mutation checks are complete; current-head CI staging and independent T1 approval remain required.

## Provenance

Session-reported model gpt-6.1-sol, reasoning effort unavailable, external session unverified. The lane declaration is codex-sol-medium / gpt-6.1-sol / medium. Missing telemetry is not inferred, and no new routing override or PM merge approval is claimed.

## Merge SHA Binding

Merge SHA: `2c52ca206c2c8c1fc570ef23f2cb6760084ebf6a`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1811
