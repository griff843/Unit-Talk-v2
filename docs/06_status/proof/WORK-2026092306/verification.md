# PROOF: WORK-2026092306

MERGE_SHA: 57d752471e18a13035dac1e9606d1f99db4d4646

Generated at: 2026-09-23T14:37:26.000Z
Issue: WORK-2026092306
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092306-effective-settlement-intel
Head SHA: 57d752471e18a13035dac1e9606d1f99db4d4646
result: pass

## ASSERTIONS:

- [x] `getIntelligenceData` (`apps/command-center/src/lib/data/analytics.ts`) no longer selects
      `settlement_records` with `.is('corrects_id', null)`. That filter returns each pick's chain
      **root**, so every corrected pick's recent form, score bands, decision quality and feedback
      loop reported the result it had been corrected away from.
- [x] It now reads the picks behind the last 200 settlement records, reads each such pick's full
      history (chunked at 100 ids), and reduces it to one row with the domain's
      `resolveEffectiveSettlement` — the tip of the `corrects_id` chain, carrying the tip's own
      result and payload.
- [x] A chain that does not resolve — an orphan correction, two roots, two corrections of one
      record, a cycle — is excluded and **counted**, and the count is surfaced as an insights
      warning (`Settlement History`), never guessed and never silent.
- [x] A chain whose tip is `manual_review` is not counted as a settlement, and is not counted as
      broken either.
- [x] Form windows stay ordered by the chain root's `settled_at`, so a late correction does not
      move an old game to the front of "last 5".
- [x] Scope: 2 source files, both in `apps/command-center`. The other settlement readers in this
      file (`getPerformanceCohort` callers) already resolve chains and are unchanged. No API,
      domain, DB, delivery or containment change, and no production write.
- [x] Mutation drill: each of 5 mutations turns the test that names it red; the restored file
      passes 29/29.

## EVIDENCE:

### 1. Mutation drill — `selectEffectiveSettlementRows` in `analytics.ts`

Each mutation was applied alone, the suite run, and the file restored byte-for-byte from a copy
(`cmp` confirmed) before the next.

```
== M1-root-not-tip        (return the chain root — main's behaviour)
not ok 22 - a corrected pick reports the correction, not the superseded original
not ok 23 - the effective record is the tip of a multi-step chain, whatever order the rows arrive in
# pass 27
# fail 2
== M2-no-orphan-guard     (drop the corrects_id-target-present check)
not ok 24 - a correction whose target is absent is excluded and counted, never read as a root
# pass 28
# fail 1
== M3-no-branch-check     (drop correction_depth + 1 === rows)
not ok 26 - two corrections of the same record are excluded rather than one silently winning
# pass 28
# fail 1
== M4-manual-review-counted (drop the settled-tip filter)
not ok 27 - a chain whose tip is in manual review is not a settlement
# pass 28
# fail 1
== M5-order-by-tip        (order by the correction's settled_at)
not ok 28 - rows are ordered by the original settlement, so a late correction does not jump the form window
# pass 28
# fail 1
restored
# pass 29
# fail 0
```

M2 matters beyond the helper: `resolveEffectiveSettlement` walks from the root through
`corrects_id` and never visits a correction whose target is absent, so without the guard an
orphan correction is silently ignored and the root's result is reported as the pick's.

### 2. Tests

```
$ pnpm exec tsx --test apps/command-center/src/lib/data/analytics.test.ts
# tests 29
# pass 29
# fail 0

$ (cd apps/command-center && pnpm test)
# tests 671
# pass 671
# fail 0

$ pnpm test
tests 6816, pass 6816, fail 0 (zero 'not ok' TAP lines across the workspace)
```

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: operator-ui
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] Command Center `tsc --noEmit`: exit 0
- [x] `pnpm exec eslint` on the 2 changed source files: exit 0
- [x] Command Center `pnpm test`: 671 pass, 0 fail
- [x] `pnpm test`: 6816 pass, 0 fail
- [x] `ops:preflight` (PB2 runs the full `pnpm test`): PASS, 38 checks
- [x] Mutation drill: each of the 5 mutations turns a distinct test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2. The change is a read-side reduction in a Command Center data loader, with no
write path and no runtime configuration change. No live-DB proof is claimed. The reduction itself
is pure and fully covered above; the two PostgREST reads it feeds on (`select pick_id` ordered by
`settled_at`, and `.in('pick_id', …)` on `settlement_records`) use columns present in
`packages/db/src/database.types.ts`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1634
Execution SHA: 57d752471e18a13035dac1e9606d1f99db4d4646
