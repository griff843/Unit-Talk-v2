# UTV2-1916 — Diff Summary

**Issue:** UTV2-1916 — a slip refusal is rendered at the leg it is about
**Tier:** T2
**Lane type:** delivery-ui
**Branch:** `claude/utv2-1916-leg-scoped-slip-refusal`
**Executor:** claude

## Merge SHA Binding

Merge SHA: `92c25c80d51dbe8a2b57f724d912d89888327b1a`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1584
## What changed

| File | +/- | What |
|---|---|---|
| `apps/smart-form/lib/bet-slip.ts` | +95 / -3 | `RefusalScope` (`draft` / `leg` / `slip`) added to `SlipRefusal`; `refusalLegId`, `revalidateSlip`, `refusalForLeg` and `legRefusalMessages` exported. `addLeg`'s two refusals gain the scope each one actually has. |
| `apps/smart-form/test/bet-slip.test.ts` | +102 / -0 | Five tests under `describe('refusal scope')`; the suite goes 18 → 23. |
| `apps/smart-form/e2e/multi-leg-slip.spec.ts` | +76 / -0 | One viewport-parameterised browser test at 1440×1000 and 390×844: a three-leg slip, a refusal that names no leg, and the assertion that no row carries it. |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | +51 / -4 | A leg-scoped refusal renders inside its own `<li>` as `slip-leg-refusal`, associated by `aria-describedby` and keyed by `data-leg-id`. The existing `slip-refusal` region keeps the draft- and slip-scoped ones. |
| `apps/smart-form/app/submit/components/BetForm.tsx` | +10 / -0 | Derives `legRefusals` from `legRefusalMessages(revalidateSlip(slipLegs))` and passes it to the panel. |

Total: **5 files, +334 / -7**, all under `apps/smart-form/**`. No migrations, no workflow files, no `apps/api`, no contracts, no `package.json`.

## Why identity rather than position

A message pinned to an index is correct only until the operator reorders the slip. `legRefusalMessages` returns a `legId -> message` map and `SlipLegList` looks each leg up by its own id, so a reorder carries every message with the leg it names. The same construction is what keeps a draft- or slip-scoped refusal off the rows: `refusalLegId` returns `null` for both, and a refusal with a null leg id is never entered into the map, so it structurally cannot reach a row.

## The omission, stated as a boundary

There is **no operator-reachable producer of a leg-scoped refusal in this lane**. `addLeg` refuses to admit a leg that fails validation, so a committed leg cannot become incomplete through the UI. Weakening that guard to manufacture one would delete the guarantee UTV2-1915 exists for; a test-only hook would make the assertion about the hook. The rendering channel is built and proven at the unit boundary, and its first real producer is the per-leg refusals the parlay ticket API returns (UTV2-1912's API third).

## Containment

Track Only and member delivery are untouched. This lane adds no submission path — the multi-leg slip still refuses to submit, and the browser test asserts the endpoint receives nothing. No production read, no production write, SGO untouched, no provider credential read.
