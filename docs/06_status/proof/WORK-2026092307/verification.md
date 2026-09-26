# PROOF: WORK-2026092307

MERGE_SHA: 051c474c5a0ba3c5054b3f9e62fb44a79a837053

Generated at: 2026-09-23T19:28:20.000Z
Issue: WORK-2026092307
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092307-settlement-chain-windows
Head SHA: ec51e7890543520242c33adeac09801664ba85b3
result: pass

## ASSERTIONS:

- [x] `getRecapData`, `getSnapshotData` and `getPicksPipelineData`
      (`apps/command-center/src/lib/data/snapshot.ts`) no longer resolve effective settlements
      from a `created_at`-ordered window of `settlement_records`. The window now only chooses
      which picks to show, and each chosen pick's full history is read by `pick_id` (chunked at
      100 ids) and resolved whole.
- [x] A chain with two or more rows in the window and its root outside it used to resolve to
      `NO_ROOT_RECORD`, so the pick disappeared from the dashboard recap's record, hit rate and
      ROI. It is now counted with the tip's result and a correction count of 1.
- [x] The pipeline used to show no result for a recent pick whose settlement predated the
      independent 26-row settlement window. It now shows the pick's effective result.
- [x] `resolveEffectiveSettlement` accepts any lone record without reading `corrects_id`, and
      otherwise ignores rows its root-to-tip walk does not reach. A chain is therefore accepted
      only when every `corrects_id` target is present **and**
      `correction_depth + 1 === rows.length`. An orphan correction or a branched chain is
      excluded, not represented by a record the chain cannot vouch for.
- [x] The recap keeps its population: the picks with settlement activity in the window.
- [x] Scope: 2 files, both in `apps/command-center`. No API, domain, DB, delivery or
      containment change, and no production write.
- [x] Mutation drill: each of 4 mutations turns the test that names it red, and the restored
      file passes 5/5.

## EVIDENCE:

### 1. Mutation drill: `snapshot.ts`

Each mutation was applied alone, the suite run, and the file restored from a copy before the next.

```
== M1 recap reads window only        (resolve the created_at window, not the history)
not ok 1 - recap counts a chain whose root fell outside the window, with the tip result
# pass 3
# fail 1
== M1b pipeline reads nothing         (pipeline gets no history)
not ok 4 - pipeline shows a recent pick settled outside the settlement window with its effective result
# pass 3
# fail 1
== M2 no reconcile check              (drop correction_depth + 1 === rows.length)
not ok 5 - recap excludes a branched chain -- two corrections of one record -- instead of picking a branch
# pass 4
# fail 1
== M3 no completeness guard           (drop the corrects_id-target-present check)
not ok 2 - recap does not count a lone correction whose target cannot be read
# pass 3
# fail 1
== restored
# pass 5
# fail 0
```

The first draft of these tests did not fail under M1. A lone in-window correction resolves to
itself, because `resolveEffectiveSettlement` short-circuits on one record, so the original
"root fell out" test passed on the broken code. The test now uses a two-correction chain, and M3
was added for the lone-orphan case the short-circuit hides.

### 2. Tests

```
$ pnpm exec tsx --test apps/command-center/src/lib/data/snapshot-settlement-history.test.ts
# tests 5
# pass 5
# fail 0

$ (cd apps/command-center && pnpm test)
# tests 684
# pass 684
# fail 0

$ pnpm test
tests 6838, pass 6838, fail 0 (zero 'not ok' TAP lines across the workspace)
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
- [x] Command Center `pnpm test`: 684 pass, 0 fail
- [x] `pnpm test`: 6838 pass, 0 fail
- [x] `ops:preflight` (PB2 runs the full `pnpm test`): PASS, 38 checks
- [x] Mutation drill: each of the 4 mutations turns a distinct test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2. The change is a read-side reduction in a Command Center data loader, with no
write path and no runtime configuration change. No live-DB proof is claimed. The added
PostgREST read (`select('*').in('pick_id', …)` on `settlement_records`) uses a column present
in `packages/db/src/database.types.ts`, and the tests drive it through the real Supabase client
against a stubbed loopback `fetch`.

## Merge SHA Binding

Merge SHA: 051c474c5a0ba3c5054b3f9e62fb44a79a837053
PR: https://github.com/griff843/Unit-Talk-v2/pull/1635
Execution SHA: ec51e7890543520242c33adeac09801664ba85b3
