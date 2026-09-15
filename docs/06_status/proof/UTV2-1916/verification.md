# PROOF: UTV2-1916 — a slip refusal is rendered at the leg it is about

**Issue:** UTV2-1916 — leg-scoped slip refusal
**Tier:** T2 · **Lane type:** delivery-ui · **Executor:** claude

## Merge SHA Binding

MERGE_SHA: pending merge
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1584
Anchor commit (implementation): 2af7f2fced0b99361c52a76dc35623d972a2a0c4

## ASSERTIONS:

1. A refusal about a committed leg carries that leg's identity, and the assertion that says so fails
   when the identity is dropped.
2. A slip-scoped refusal is **not** attributed to any leg, and neither is the draft-scoped refusal
   for a candidate leg that no row holds.
3. UTV2-1915's entry-survival guarantee — `addLeg` returns the caller's legs unchanged on refusal —
   still passes unchanged.
4. In a three-leg slip, at both the desktop and mobile widths already screenshotted in UTV2-1915's
   bundle, a refusal that names no leg is rendered in the slip-level region and **no row** carries it
   or gains an `aria-describedby`.
5. Each new assertion fails on the condition it names, proven by a six-mutation battery.

## EVIDENCE:

Commands run in the lane worktree `.out/worktrees/claude__utv2-1916-leg-scoped-slip-refusal` and
transcribed from the runs, not recalled:

```
$ pnpm --filter @unit-talk/smart-form type-check
> tsc --noEmit
(exit 0, no diagnostics)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1916 --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: operator-ui
```

- [x] `pnpm --filter @unit-talk/smart-form type-check`: exit 0
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1916 --head HEAD`: PASS, `operator-ui`
      matched, no missing required artifacts
- [ ] `pnpm test`: not run in full on this workstation for this lane. The changed surface is
      `apps/smart-form/**` only, and that package's own suite was run in full. The root `pnpm test`
      runs in CI on this branch and that run is the binding one.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @unit-talk/smart-form type-check` | clean, exit 0 |
| `pnpm --filter @unit-talk/smart-form test` | **198 pass / 0 fail**, 23 suites, 1624ms |
| `pnpm exec tsx --test apps/smart-form/test/bet-slip.test.ts` | **23 pass / 0 fail** |
| `SMART_FORM_E2E_PORT=4155 SMART_FORM_E2E_API_PORT=4055 NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 pnpm exec playwright test -c playwright.config.ts e2e/multi-leg-slip.spec.ts --reporter=line` | **4 passed (18.0s)** |

`pnpm verify` is **not** claimed green locally: it terminates at `ci:assert-staging`, which pins the
staging project ref and cannot run from this workstation. It runs in CI on this branch, and that run
is the binding one.

## What the browser test actually exercises

`e2e/multi-leg-slip.spec.ts` drives the real component tree offline: `installOfflineFixture` aborts
every non-local hostname as `blockedbyclient` and the test asserts the denied list is empty at the
end, so a pass cannot depend on a network call that quietly succeeded. The clock is fixed at
`2026-09-15T20:05:00.000Z`.

The new test is parameterised over the two widths UTV2-1915 screenshotted — **1440×1000** and
**390×844**. It builds a three-leg slip and asserts zero `slip-leg-refusal` elements and no
`aria-describedby` on any row; clears Odds and attempts to add a fourth leg; then asserts that the
resulting refusal names `Odds` in the slip-level region, that the slip still holds **3** legs, that
`slip-leg-refusal` count is still **0** — *"a refusal that names no leg must not be rendered at a
row"* — and that no row gained an `aria-describedby`. It then reads the multi-leg refusal, clicks
submit, and asserts `submitted === []` and `denied === []`.

**A locator defect was found and fixed by this run rather than worked around.** Two controls carry
`data-testid="smart-form-submit-button"` — the desktop panel button (`hidden lg:flex`,
`BetSlipPanel.tsx:276`) and the mobile sticky bar (`lg:hidden`, `:331`) — and exactly one is visible
at a given width. `.first()` selects by DOM order, not by visibility, so at 390px it resolved the
hidden desktop control and the click timed out after 30s. The test now selects
`[data-testid="smart-form-submit-button"]:visible`, which is the control the operator would actually
press at each width. Before the fix: `1 failed, 3 passed`. After: **4 passed**.

## What the browser proof does NOT show, and why

Acceptance criterion 4 asks for the refusal rendered **at** the offending row. The positive half of
that has **no operator-reachable producer today**: `addLeg` refuses to admit a leg that fails
validation, so no committed leg can be incomplete through the UI. Both ways to manufacture one were
rejected — weakening `addLeg` would delete the guarantee UTV2-1915 exists for, and a test-only hook
would make the assertion about the hook rather than about the product.

So the browser proves the negative half at both widths (a refusal naming no leg reaches no row), and
the keying itself — id → message, a reorder carrying each message with its own leg — is proven at the
unit boundary by M1 and M5 below. The gap is recorded in `known_gaps` and in a comment at the
assertion site naming the real future producer: the per-leg refusals the parlay ticket API returns,
for which `legRefusalMessages` is the rendering channel.

## Mutation battery — six mutations, six caught

Run alone, with no concurrent suite. Each mutation was applied in isolation to
`apps/smart-form/lib/bet-slip.ts`, the suite run, then the file restored and the baseline re-run.

| # | Mutation | Assertions that turned red |
|---|---|---|
| M1 | `revalidateSlip` drops the leg identity from the refusal it emits | `a refusal about a committed leg carries that leg's identity`; `legRefusalMessages keys every leg-scoped refusal by its own leg` |
| M2 | `refusalLegId` attributes a slip-scoped refusal to a leg | `a slip-scoped refusal is not attributed to any leg`; `a refusal for the candidate leg is draft-scoped, because no row holds it` |
| M3 | `addLeg` marks the candidate refusal leg-scoped instead of draft-scoped | `a refusal for the candidate leg is draft-scoped, because no row holds it` |
| M4 | `revalidateSlip` refuses a leg that validates | `a refusal about a committed leg carries that leg's identity`; `a slip whose legs all validate carries no leg-scoped refusal` |
| M5 | `legRefusalMessages` keys by position instead of by leg id | `legRefusalMessages keys every leg-scoped refusal by its own leg` |
| M6 | `addLeg` discards the committed legs when it refuses | `leaves the existing legs untouched when it refuses`; `a refusal for the candidate leg is draft-scoped…` |

Baseline restored after the battery: exit 0, **23 pass / 0 fail**.

**M5 is the decisive one for this lane's stated purpose.** Position-keying passes every test that
only ever builds the slip in order; the assertion that kills it is the one that reorders and then
reads the map back by id. **M6 is criterion 3**: it is UTV2-1915's own assertion, unchanged, still
failing on exactly the condition it named before this lane touched the file.

## Screenshots

- `screenshot-desktop.png` — 1440×1000, full page, three-leg slip with a refusal that names no leg.
- `screenshot-mobile.png` — 390×844, full page, same state: the three legs, the slip-level refusal
  reading `This leg is not complete. Add or check: Odds.` below the leg list and at no row, the
  multi-leg refusal, the Track Only pill, and the mobile sticky bar reading "3 legs on slip".

Both were captured from the same offline fixture as the e2e tests, with the same fixed clock, by a
temporary block inside `multi-leg-slip.spec.ts` that was removed afterwards — verified removed by
`grep -c "__capture"` returning 0.

## Containment and production impact

**None.** No production read, no production write, no deployment, no containment change, no SGO
activity, no provider credential read. Track Only and member delivery are untouched — this lane adds
no submission path, and the multi-leg slip still refuses to submit.
