# PROOF: WORK-2026103005

MERGE_SHA: pending merge

ASSERTIONS:

- Private, unknown and mismatched audience pins are excluded from the in-scope member readers; legacy absent audiences remain members.
- Outbox audience is pinned at release. Canonical pick records, Track Only controls and private per-pick recap destination are preserved.
- Every implemented reader class kills the shared-predicate mutant. Insert-time pick pinning and public previews remain the separately approved successor scope.

EVIDENCE:

The rebindable anchor above intentionally remains pending before merge. Execution identity is the verified source SHA below; supported closeout will bind the actual merge SHA.

Status: local source verification complete; exact-head CI staging and T1 PM review pending.

## Verification

Verified source candidate: `916228ed77abdfc05f49549148f2e22818786f78`.

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

Production Claude's #1811 comment 6530796692 moves the persisted pick pin to WORK-2026103021 Part B at submission insert time and removes it from this lane's remaining acceptance. Public previews/score readers are also separately assigned there. No production-canary readiness or exhaustive anonymous isolation is claimed until that successor lands. This lane's local implementation and mutation checks are complete; current-head CI staging and independent T1 approval remain required.

## Provenance

Session-reported model gpt-6.1-sol, reasoning effort unavailable, external session unverified. The lane declaration is codex-sol-medium / gpt-6.1-sol / medium. Missing telemetry is not inferred, and no new routing override or PM merge approval is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1811
