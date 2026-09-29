# PROOF: WORK-2026092812

MERGE_SHA: 617ceb93c26c13cbea597971306b4a9a5609a8f1

Issue: WORK-2026092812
Tier: T2
result: static verification complete; writable live-DB proof deferred to staging CI

## ASSERTIONS:

- [x] A complete refused Track Only authorization displays as refused with its reason, authority, decision time, requested/persisted mode, manual coverage-gap provenance, edge scope reason, eventless settlement note, and voided banner.
- [x] A complete authorized record displays as authorized only when accepted by `readHumanCapperDeliveryAuthorization`.
- [x] A malformed authorization renders “No delivery authorization recorded” and never renders as authorized.
- [x] A governed list row shows capper, units, and Track Only instead of suppressed routing; an ungoverned row retains the routing display.

## EVIDENCE:

Focused static render test, re-run by the orchestrator on the lane head after merging `main`:

```
$ cd apps/command-center && npx tsx --test src/app/command-center-pages.test.tsx
# tests 10
# pass 10
# fail 0
```

R-level check on the implementation commit against its merge base:

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base a6ca76a2b3205b459580dfa09f5d1a98f28d7e8f --head 79b1c9b95a77288ba36ae6da03f4b7b3e58f1d71
Verdict: PASS
Changed files: 11
Rules matched: operator-ui
```

## Verification

- `npx tsx --test src/app/command-center-pages.test.tsx` (from `apps/command-center`) — PASS: 10 tests, 10 passed, 0 failed.
- `pnpm verify:static` — PASS: static gate completed after environment validation, lint, project-reference type-check/build, aggregate tests, Smart Form verification, and command verification. No DB access or writes are part of this display-only lane.
- `pnpm type-check` is included in `pnpm verify:static` and passed under the root project-references build.
- `pnpm test` is included in `pnpm verify:static` and passed under the root aggregate suite.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base a6ca76a2b3205b459580dfa09f5d1a98f28d7e8f --head 79b1c9b95a77288ba36ae6da03f4b7b3e58f1d71` — PASS: 11 changed files, rule matched `operator-ui`.
- `pnpm verify` passed in the required CI `verify` context on head `0d5c296ef6c6af8f7bc902c59e7b4d5772a953b1`, which carries implementation commit `79b1c9b95` unchanged.

Writable live-DB proof is deferred as required: the lane makes no database writes, and writable verification must run through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.

## Merge SHA Binding

Merge SHA: `617ceb93c26c13cbea597971306b4a9a5609a8f1`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1685
