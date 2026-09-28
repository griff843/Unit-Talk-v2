# PROOF: WORK-2026092812

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: WORK-2026092812
Tier: T2
result: static verification complete; writable live-DB proof deferred to staging CI

## ASSERTIONS:

- [x] A complete refused Track Only authorization displays as refused with its reason, authority, decision time, requested/persisted mode, manual coverage-gap provenance, edge scope reason, eventless settlement note, and voided banner.
- [x] A complete authorized record displays as authorized only when accepted by `readHumanCapperDeliveryAuthorization`.
- [x] A malformed authorization renders “No delivery authorization recorded” and never renders as authorized.
- [x] A governed list row shows capper, units, and Track Only instead of suppressed routing; an ungoverned row retains the routing display.

## EVIDENCE:

Focused static render test: 10 passed, 0 failed.

## Verification

- `npx tsx --test src/app/command-center-pages.test.tsx` (from `apps/command-center`) — PASS: 10 tests, 10 passed, 0 failed.
- `pnpm verify:static` — PASS: static gate completed after environment validation, lint, project-reference type-check/build, aggregate tests, Smart Form verification, and command verification. No DB access or writes are part of this display-only lane.
- `pnpm type-check` is included in `pnpm verify:static` and passed under the root project-references build.
- `pnpm test` is included in `pnpm verify:static` and passed under the root aggregate suite.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS before the implementation commit; no R-level rules matched. Re-run after the final commit is required before PR creation.

Writable live-DB proof is deferred as required: the lane makes no database writes, and writable verification must run through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
