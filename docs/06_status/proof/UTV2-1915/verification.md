# PROOF: UTV2-1915 — Smart Form multi-leg bet slip

**Issue:** UTV2-1915 — Smart Form multi-leg bet slip
**Tier:** T2 · **Lane type:** delivery-ui · **Executor:** claude

## Merge SHA Binding

MERGE_SHA: pending merge
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1583
Anchor commit (implementation): 696ba732c14b969aead13779a300e1d6b7e23348

## ASSERTIONS:

1. An operator can add a leg to the slip, remove one, and reorder one, and each operation is proven
   by a unit test that names the condition it enforces.
2. A leg that fails validation is **refused by name** and the caller's leg list is returned
   unchanged, so a refusal can never be mistaken for a mutation.
3. `moveLeg` refuses to wrap at either end rather than silently cycling.
4. The slip never displays or computes a combined parlay price — pricing belongs to
   `@unit-talk/contracts`, and a test fails if `LegSummary` grows a price-shaped field.
5. A multi-leg slip **cannot reach the submission endpoint**. The guard lives in the submit handler,
   not in a hidden control, and the browser test asserts the endpoint received nothing.
6. Track Only containment and member-delivery state are untouched: this lane adds no submission path.

## EVIDENCE:

Repository-wide commands, run in the lane worktree and transcribed from the runs:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1915 --head HEAD
Verdict: PASS
Changed files: 12
Rules matched: operator-ui
```

- [x] `pnpm type-check`: exit 0
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1915 --head HEAD`: PASS, 12 changed
      files, `operator-ui` matched, no missing required artifacts
- [ ] `pnpm test`: not run in full on this workstation for this lane. The changed surface is
      `apps/smart-form/**` only, and that package's own suite was run in full (193 pass / 0 fail, 22
      suites) alongside the new file in isolation (18 pass / 0 fail). The root `pnpm test` runs in CI
      on this branch and that run is the binding one.

## Verification

All four commands were run in the lane worktree
`.out/worktrees/claude__utv2-1915-smart-form-multi-leg-slip`. Results are transcribed from the runs,
not recalled.

| Command | Result |
|---|---|
| `pnpm exec tsx --test test/bet-slip.test.ts` | **18 pass / 0 fail** |
| `pnpm --filter @unit-talk/smart-form type-check` | clean |
| `pnpm --filter @unit-talk/smart-form test` | **193 pass / 0 fail**, 22 suites |
| `SMART_FORM_E2E_PORT=4155 SMART_FORM_E2E_API_PORT=4055 NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 pnpm exec playwright test -c playwright.config.ts e2e/multi-leg-slip.spec.ts --reporter=line` | **2 passed (14.0s)** |

`pnpm verify` is **not** claimed green locally: it terminates at `ci:assert-staging`, which pins the
staging project ref and cannot run from this workstation. It runs in CI on this branch, and that run
is the binding one.

## What the browser tests actually exercise

`e2e/multi-leg-slip.spec.ts` drives the deployed component tree offline: `page.route('**/*')` aborts
every non-local hostname as `blockedbyclient` and the test asserts the denied list is empty at the
end, so a pass cannot depend on a network call that quietly succeeded. Reference-data search answers
**200 with `{data: []}`** rather than an error, which is what puts the form on its honest manual-entry
path — the path the contained pilot actually uses, because NFL has 32 team rows and zero players and
NCAAF has nothing at all.

Test 1 — *an operator builds, reorders and trims a multi-leg slip, and it never submits*: adds a leg;
clears Odds and adds again, and asserts `slip-refusal` names **Odds** while the slip still holds
exactly **1** leg; adds a second leg; reorders with `Move leg 2 up`; reads the multi-leg refusal;
clicks the submit button and asserts
`expect(submitted, 'a multi-leg slip must not reach the submission endpoint').toEqual([])`; removes a
leg and watches the refusal disappear.

Test 2 — *the slip never displays a combined parlay price*: builds two legs and asserts the rendered
slip contains no `/combined/i`, `/parlay odds/i` or `/total payout/i`.

The submit control stays **enabled** throughout. Refusal is enforced in the handler and rendered as a
reason, so the test observes a refusal rather than the absence of a control — a hidden button would
have made the assertion vacuous.

## Mutation battery — five mutations, five caught

Each mutation was applied alone, the suite run, then the baseline restored and re-run green.

| # | Mutation | Result |
|---|---|---|
| M1 | `addLeg` returns `legs: []` instead of the unchanged list on refusal | 17 pass / **1 fail** |
| M2 | `LegSummary` grows a `combinedOdds` field | 17 pass / **1 fail** |
| M3 | `moveLeg` wraps around at the ends instead of refusing | 17 pass / **1 fail** |
| M4 | the `MAX_SLIP_LEGS` ceiling is removed (`if (false)`) | 17 pass / **1 fail** |
| M5 | the `isMultiLegSlip(slipLegs)` guard is removed from `onSubmit` | **1 failed / 1 passed** — `Error: a multi-leg slip must not reach the submission endpoint` |

M5 is the decisive one: it is the only mutation that could let a multi-leg slip reach the submission
endpoint, and the e2e assertion that names that condition is what failed. Restoring the guard
returned **2 passed**.

M1 deserves a note because it is the mechanism behind a product requirement rather than a style
choice: `addLeg` returns the caller's `legs` **unchanged** on refusal, so a validation error can never
be mistaken for a mutation and committed legs structurally cannot be discarded by a bad entry.

## One measured fact recorded rather than papered over

A first draft asserted that a leg missing both a base field and a market-specific field reports both.
It does not: zod runs `.superRefine` only after the base object parses, so refusal is staged. Rather
than loosen the assertion, the test was split into two — one for the base-field refusal (`Odds`), one
for the market-specific refusal (`Team`) — and the staging is recorded in a comment at the assertion
site. Asserting both at once would have passed for the wrong reason or failed for a reason that is
not a defect.

## Screenshots

- `screenshot-desktop.png` — 1440×1000, full page, two-leg slip: the leg list with its move and
  remove controls, the multi-leg refusal text, and the single-pick summary panel below it unchanged.
- `screenshot-mobile.png` — 390×844, full page, same state.

Both were captured from the same offline fixture as the e2e tests, with a fixed clock, by a temporary
spec that was deleted afterwards.

## Containment and production impact

**None.** No production read, no production write, no deployment, no containment change, no SGO
activity, no provider credential read. Track Only and member delivery are untouched — this lane adds
no submission path at all, and the multi-leg path is a refusal.
