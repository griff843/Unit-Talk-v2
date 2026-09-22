# PROOF: UTV2-1925 — Smart Form receipt reports server truth

**Issue:** UTV2-1925 — the submission receipt must describe what the server did, not what the browser asked for
**Tier:** T2 · **Lane type:** delivery-ui · **Executor:** claude

## Merge SHA Binding

MERGE_SHA: 97af7f25841893f87b3ec36e4713cb31901b463f
Merge SHA: 97af7f25841893f87b3ec36e4713cb31901b463f
PR: https://github.com/griff843/Unit-Talk-v2/pull/1594
Anchor commit (implementation): ca8e98878482a9bff510af84ed4d09049c0fcd4d

The schema-v2 binding lives in the sibling `evidence.json`: `sha_binding.merge_sha` is `null`
pre-merge, and `sha_binding.verified_source_sha` names the implementation commit these measurements
were taken on. That block, not the prose row above, is the contract this bundle is validated under.

## ASSERTIONS:

1. The receipt's delivery sentence is a function of the **server response only**. No field of
   `submittedValues` — in particular `trackOnly` — can reach it.
2. `outboxEnqueued: true` is the one positive delivery fact the surface will state, and it states it
   as an observation about this submission rather than as a property of the pick.
3. `lifecycleState === 'awaiting_approval'` renders "Awaiting operator approval", not
   "no member delivery". This is the case the PM's acceptance criterion names, and it is the case
   the previous code got wrong.
4. An **absent** `outboxEnqueued` resolves to `undetermined` — "the server did not report a delivery
   outcome" — and never to the reassuring reading. "The server did not say" and "the server said no"
   stay distinguishable.
5. The literal sentence `No member delivery.` appears in none of the three submit-surface components.
   A permanent-property claim cannot be made from a single submission response.
6. Pre-submission controls describe the **request** ("Track Only requested"), never the outcome.
7. The UI grants no delivery authorization: `delivery-disposition.ts` has no imports at all, and
   nothing in this diff touches `apps/api`, the outbox, the kill switch or any containment setting.
8. Containment is untouched. The server-side Track Only pin and its mutation-tested guard set are
   not modified.

## EVIDENCE:

Commands run in the lane worktree `.out/worktrees/claude__utv2-1925-smart-form-receipt-server-truth`,
transcribed from the runs rather than recalled:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm test
# tests 6398
# pass 6398
# fail 0
(exit 0)

$ pnpm --filter @unit-talk/smart-form test
# tests 206
# pass 206
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1925 --head HEAD
Verdict: PASS
Changed files: 20
Rules matched: operator-ui

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no diagnostics)
```

- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: exit 0, **6398 pass / 0 fail** across the whole repository
- [x] `pnpm --filter @unit-talk/smart-form test`: **206 pass / 0 fail** (33 of them in
      `test/api-client.test.ts`, the file this lane extends)
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1925 --head HEAD`: PASS, `operator-ui`
- [x] `pnpm lint`: exit 0
- [ ] `pnpm verify`: **not** claimed green locally. It terminates at `ci:assert-staging`, which pins
      the staging project ref and cannot run from this workstation. It runs in CI on this branch and
      that run is the binding one.

## Verification

| Command | Result |
|---|---|
| `pnpm type-check` | clean, exit 0 |
| `pnpm test` | **6398 pass / 0 fail**, exit 0 |
| `pnpm --filter @unit-talk/smart-form test` | **206 pass / 0 fail** |
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1925 --head HEAD` | **PASS**, `operator-ui` |
| `pnpm lint` | clean |

`pnpm build` was run once before the suite: a fresh worktree has no `packages/*/dist`, and the
smart-form tests fail with `Cannot find module '../../../../../packages/config/dist/env.js'` until it
does. That is a worktree bootstrap fact, not a defect in this lane.

## Mutation battery — four mutations, four caught

Each mutation was applied alone, the suite run, then the baseline restored from a copy and re-run
green. Each patch **asserts its anchor string is present before writing**: `str.replace` returns the
original text on a miss, so an inline patch that fails to match reports a surviving mutant and a
reassuring green suite. That assert is the control on the control, and it is here because the
omission produced exactly that false negative on the sibling lane.

| # | Mutation | Result |
|---|---|---|
| M1 | `undetermined` defaults to "Track Only — no member delivery." | 32 pass / **1 fail** |
| M2 | `awaiting_approval` folded into `not-enqueued` | 32 pass / **1 fail** |
| M3 | a missing `outboxEnqueued` is read as `false` rather than unknown | 32 pass / **1 fail** |
| M4 | the receipt reverts to `v.trackOnly` for its delivery sentence | 31 pass / **2 fail** |
| — | baseline restored | **33 pass / 0 fail** |

M4 is the decisive one: it reintroduces the exact defect the PM's acceptance criterion names, and
the suite refuses it. M1 and M3 are the two ways the surface could drift back toward the reassuring
answer without anyone editing the receipt — both are caught in the resolver.

## What the tests assert, and what they refuse to assert

Two of the eight new tests are **structural controls that read the files**, because the unit
assertions alone cannot see a second path being added later — which is close to how the original
defect arrived:

- `delivery-disposition.ts` contains no `import` statement and names neither `form-schema`,
  `BetFormValues`, `trackOnly` nor `submittedValues` **in executable code**.
- `SuccessReceipt.tsx` no longer reads `v.trackOnly`, does call `resolveDeliveryDisposition(result)`,
  and the literal `No member delivery.` appears in none of the three submit-surface components.

Both controls strip comments before asserting. The first drafts matched the modules' own explanatory
comments and failed; the fix was to assert on code rather than to delete the explanation, since
forcing a file to stop explaining itself in order to satisfy a grep is the wrong direction.

Nothing here asserts that a page rendered. A render assertion would pass against a receipt showing a
confidently wrong sentence, which is the failure this lane exists to prevent.

## Measured, and recorded rather than changed

`apps/smart-form/lib/form-utils.ts:350` lets the client *propose*
`distributionMode: 'delivery-eligible'` from `values.trackOnly`. Whether the server on `main` honours
a client-proposed value bears directly on "browser/client cannot grant delivery", and it is an
`apps/api` question — outside this lane's `apps/smart-form/**` file scope, which a `delivery-ui` lane
cannot widen. It is recorded here rather than changed, per the governance debt policy.

What this lane *can* say about it is structural and is asserted above: the resolver that decides what
the receipt claims cannot read `values.trackOnly`, because it cannot read `values` at all.

## One correction to the sibling lane's proof

`docs/06_status/proof/UTV2-1924/verification.md` records, under "Known gap", that this work depends
on `deliveryPosture` from the unmerged UTV2-1923 branch. Measured against `main`, it does not:
`submitPickController` already returns `outboxEnqueued`, `lifecycleState`, `promotionStatus` and
`promotionTarget`, and only the client-side `SubmitPickResult` interface discarded them. That claim
was a prediction made before the server response was read; this lane is the measurement.

## Containment and production impact

**None.** No production read, no production write, no deployment, no containment change, no SGO
activity, no provider credential read. The diff is confined to `apps/smart-form/**` and changes only
what text a receipt renders.
