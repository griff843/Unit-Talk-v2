# PROOF: UTV2-1924 — Human Capper surface truth (Command Center statistics)

**Issue:** UTV2-1924 — capper-attributed, units-weighted, Track-Only-excluded statistics
**Tier:** T2 · **Lane type:** delivery-ui · **Executor:** claude

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1593
Anchor commit (implementation): 540cab4af5786f9fb43d430de66d5027c433874b

## ASSERTIONS:

1. A pick is attributed to a capper **iff** it carries a canonical `picks.capper_id`. No attribution
   is ever derived from `picks.source`, and a substring match on `source` cannot reappear without
   failing a test that reads the file.
2. ROI is units-weighted over the real American price and the real stake on each decided pick, and it
   reproduces `scripts/ops/track-only/stats.ts` → `profitUnits` exactly rather than re-deriving the
   conversion.
3. A cohort in which nothing can be priced reports `roiPct: null`, **never `0`**, and every render
   site turns that null into an em dash rather than into `+0.0%`.
4. A decided pick that cannot be priced is counted in `unpriced` and contributes no units. It is
   never absorbed as a zero, which would move the ROI toward break-even.
5. Track Only picks are excluded from every published figure and reported separately. Excluding them
   changes the published number, so the filter is load-bearing rather than decorative.
6. The published per-capper records and the Unit Talk aggregate reconcile by construction: the same
   function over disjoint partitions of one cohort.
7. This app's two American-odds converters — `@unit-talk/contracts` and
   `apps/command-center/src/lib/odds-math.ts` — are pinned to agree, and the contracts validation is
   stricter rather than looser.
8. Containment is untouched. This lane reads and displays; it writes nothing, deploys nothing, grants
   no delivery authorization, and changes no containment setting.

## EVIDENCE:

Commands run in the lane worktree `.out/worktrees/claude__utv2-1924-human-capper-surface-truth`,
transcribed from the runs rather than recalled:

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1924 --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: operator-ui

$ pnpm --filter @unit-talk/command-center exec tsx --test src/lib/data/analytics.test.ts
# tests 21
# pass 21
# fail 0

$ pnpm --filter @unit-talk/command-center test
# tests 545
# pass 545
# fail 0

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no diagnostics)
```

- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1924 --head HEAD`: PASS, 11 changed
      files, `operator-ui` matched, no missing required artifacts
- [x] `pnpm --filter @unit-talk/command-center exec tsc --noEmit -p tsconfig.json`: exit 0, no
      diagnostics
- [x] `pnpm lint`: exit 0
- [x] `pnpm --filter @unit-talk/command-center test`: 545 pass / 0 fail
- [ ] `pnpm verify`: **not** claimed green locally. It terminates at `ci:assert-staging`, which pins
      the staging project ref and cannot run from this workstation. It runs in CI on this branch and
      that run is the binding one.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @unit-talk/command-center exec tsx --test src/lib/data/analytics.test.ts` | **21 pass / 0 fail** |
| `pnpm --filter @unit-talk/command-center test` | **545 pass / 0 fail** |
| `pnpm --filter @unit-talk/command-center exec tsc --noEmit -p tsconfig.json` | clean |
| `pnpm lint` | clean |
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1924 --head HEAD` | **PASS**, `operator-ui` |

`pnpm build` was run once before the suite, because `apps/command-center` resolves
`@unit-talk/config` and `@unit-talk/contracts` through their built `dist/`. A fresh worktree has no
`dist/`, and the test fails with `Cannot find module '../../../../../packages/config/dist/env.js'`
until it does. That is a worktree bootstrap fact, not a defect in this lane.

## Mutation battery — five mutations, five caught

Each mutation was applied alone to `apps/command-center/src/lib/data/analytics.ts`, the suite run,
then the baseline restored from a copy and re-run green. The five are the five ways this surface can
report a number that looks finished and is wrong.

| # | Mutation | Result |
|---|---|---|
| M1 | `computeStats` returns `roiPct: 0` instead of `null` for an unmeasurable cohort | 19 pass / **2 fail** |
| M2 | an unpriceable decided pick is absorbed into the denominator instead of counted in `unpriced` | 19 pass / **2 fail** |
| M3 | `resolveCapperId` falls back to a substring match on `picks.source` | 19 pass / **2 fail** |
| M4 | `isTrackOnlyPick` returns `false` unconditionally | 18 pass / **3 fail** |
| M5 | `isValidAmericanOdds` is replaced by a looser finite/non-zero check | 19 pass / **2 fail** |
| — | baseline restored | **21 pass / 0 fail** |

M1 is the decisive one for truthfulness: a `0.0%` ROI reads as a measured break-even, and there is
nothing in the rendered page to distinguish it from "nothing in this cohort could be priced". M4 is
the decisive one for containment-adjacent honesty: it is the only mutation that can cause a record
that was never shown to a member to be published as if it had been. M5 is the one that would price a
row the canonical contracts refuse to price at all.

M3 deserves a note. Two things catch it — `not ok 13` *a source that merely looks like a capper is
not an attribution*, and `not ok 15` *analytics.ts contains no string-guessed capper attribution*.
The second reads the file and fails if `extractCapperName`, `classifySource` or a `capper`-substring
match reappears anywhere in it. The unit assertions alone would not see a *second* attribution path
added elsewhere in the file later, which is close to how the original defect arrived.

**One measured correction, recorded rather than quietly fixed.** The first M3 run reported 21 pass /
0 fail — a surviving mutant. It was not: the mutation had never been applied, because the patch was
written inline with shell quoting that mangled the anchor string and `str.replace` returns the
original text on a miss rather than raising. The rewritten patch asserts its anchor is present before
writing, and M3 then failed as above. A mutation battery whose patches can silently no-op reports
exactly the reassuring result, so the assert is the control on the control.

## What the tests assert, and what they refuse to assert

`pickProfitUnits` is checked against an **independently restated** expectation — a positive price
pays `stake * odds/100`, a negative one `stake * 100/|odds|` — across eight prices and three stakes,
rather than against the implementation's own expression. Restating the rule is what makes the test
capable of disagreeing with the code.

The Track Only assertion is written so it cannot pass vacuously: a published `+100` win at 1u and a
Track Only `-110` loss at 1u, with an explicit `assert.notEqual` that the two cohorts give different
ROIs. If the exclusion were removed the number would move, and the test says so.

Nothing here asserts that a page rendered. A render assertion would pass against a page showing a
confidently wrong number, which is the failure this lane exists to prevent.

## Reconciliation against recap math

`apps/api/src/recap-service.ts:250` computes `roiPercent` as
`(netUnits / totalRiskedUnits) * 100` over rows whose stake is known, and names the excluded rows in
`unknownStakeCount`. That is the same rule this surface now applies: units-weighted over the priced
picks, with the unpriced ones named rather than absorbed. The two therefore reconcile on the same
cohort.

One difference is recorded rather than changed here, because it lies outside this lane's file scope:
recap returns `roiPercent: 0` when `totalRiskedUnits` is 0, where this surface returns `null`. On an
empty or wholly unpriceable cohort recap reads as a measured break-even. It is a real instance of the
same defect class this lane fixes, in `apps/api`, and is recorded as a finding rather than filed.

## Reconciliation, measured

`byCapper` and `unitTalkAggregate` are produced by calling `computeStats` once per partition and once
over the union of the same partitions. The test asserts `settled`, `wins`, `losses`, `pushes`,
`unitsStaked` and `unitsNet` sum across partitions to the aggregate. A capper total that disagreed
with the Unit Talk aggregate would be arithmetically impossible, not merely unlikely.

## Containment and production impact

**None.** No production read was performed for this lane beyond the one already recorded under
UTV2-1923, no production write, no deployment, no containment change, no SGO activity, no provider
credential read. The surface displays server truth and controls nothing: it grants no delivery
authorization, and Track Only and member-delivery state are untouched.

## Known gap, stated rather than hidden

The Smart Form half of the PM's T2 objective — *"Smart Form must not display 'Track Only / no member
delivery' to a capper whose server-authorized submission is actually entering the approval-for-delivery
path"* — is **not in this PR**. Two live lane mechanics force the split: `deriveDeliveryUiApp`
(`scripts/ops/shared.ts:949`) requires a `delivery-ui` lane's file scope to map to exactly one
canonical app root, and the Smart Form change depends on `deliveryPosture`, which exists only on the
unmerged UTV2-1923 branch. It is a separate lane opened after #1592 merges, not an omission.
