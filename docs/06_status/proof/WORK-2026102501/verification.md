# PROOF: WORK-2026102501

MERGE_SHA: 52010bf0c36b263d9374bc87dbf3085071b15abd

Issue: WORK-2026102501
Tier: T2
result: pass

## ASSERTIONS:

- [x] Every catalog stat type for NHL, NBA, MLB and NFL listed in the unit test resolves a market key without throwing (`every catalog stat type for NHL, NBA, MLB and NFL resolves a market key without throwing`).
- [x] The lookup is sport-aware: NHL Points resolves to `player_hockey_points_ou`, NBA Points to `player.points` (`player prop market keys are sport-aware`).
- [x] Previously unmapped stat types resolve to production market ids (`previously unmapped catalog stat types resolve to production market ids`).
- [x] An unknown stat type, or one from another sport, is refused with the explicit "Cannot resolve canonical market key" error and never falls back (`an unknown stat type is refused explicitly`).
- [x] A real Playwright run of the NHL Shots on Goal case returned HTTP 201, persisted the row with `distributionMode: track-only`, and found no outbox row.

## EVIDENCE:

Code commit under test: `52010bf0c36b263d9374bc87dbf3085071b15abd`. Files: `apps/smart-form/lib/form-utils.ts`, `apps/smart-form/test/form-utils.test.ts`, `apps/smart-form/e2e/phase-one.spec.ts`.

```
$ pnpm exec tsx --test apps/smart-form/test/form-utils.test.ts
# tests 37
# pass 37
# fail 0
# skipped 0

$ pnpm --filter @unit-talk/smart-form test
# tests 215
# pass 215
# fail 0

$ UNIT_TALK_SMART_FORM_E2E=1 NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 pnpm exec playwright test e2e/phase-one.spec.ts -g "Shots on Goal|structured player prop persists"
  ✓  structured player prop persists its line, stat and canonical player with no delivery
  ✓  structured NHL Shots on Goal player prop persists a hockey market and no delivery
  2 passed
```

Scope of the diff figure (implementation files only, excluding `docs/06_status/**`):

```
$ git diff --stat origin/main...HEAD -- apps/
 3 files changed, 222 insertions(+), 4 deletions(-)
```

## Verification

Commands run on code commit `52010bf0c36b263d9374bc87dbf3085071b15abd`:

- `pnpm exec tsx --test apps/smart-form/test/form-utils.test.ts`: 37 pass, 0 fail.
- `pnpm --filter @unit-talk/smart-form test`: 215 pass, 0 fail.
- `pnpm --filter @unit-talk/smart-form type-check`, `pnpm type-check`, `pnpm lint`: each exited 0.
- `ops:preflight WORK-2026102501 --refresh --tier T2`: VERDICT PASS (39 checks).
- Full `pnpm verify` runs in CI on this PR; it cannot exit 0 locally.

Not done, with reason: the e2e gate is off by default and was run only for the files above against the isolated in-memory API (Supabase variables blank, no staging or production access). The full `phase-one.spec.ts` run on this branch has 6 failures in other cases that assert the stale text `Pick Saved` at their own call sites (the UI heading is now `Saved as Track Only`); the same file on `origin/main` has 9 failures, 3 of them the shared helper this lane corrected. Those 6 sites are outside this lane's reviewed intent and were left unchanged. Selection-time hiding of unmapped stat types in `BetForm.tsx` was not done: that file is outside the declared file scope.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
