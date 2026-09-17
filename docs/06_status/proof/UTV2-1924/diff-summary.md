# UTV2-1924 — Diff Summary

**Issue:** UTV2-1924 — Human Capper surface truth: Command Center statistics
**Tier:** T2
**Lane type:** delivery-ui
**Branch:** `claude/utv2-1924-human-capper-surface-truth`
**Executor:** claude

## Merge SHA Binding

MERGE_SHA: pending merge
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1593
Anchor commit (implementation): c517574ec8a3d5351c746b96a0b19c4da21da5e9

## What changed

| File | +/- | What |
|---|---|---|
| `apps/command-center/src/lib/data/analytics.ts` | +261 / -79 | The whole of the correction. `pickProfitUnits` prices a decided pick from the real American odds and the real stake via `@unit-talk/contracts`. `computeStats` units-weights ROI and returns `null` — never 0 — for an unmeasurable cohort, counting unpriceable decided picks in `unpriced`. `resolveCapperId` / `classifyAttribution` read `picks.capper_id` only; `extractCapperName` and `classifySource` are **deleted**. `isTrackOnlyPick` partitions internal evidence out of every published figure. `getPerformanceData`, `getLeaderboard` and `getIntelligenceData` now select `capper_id`, `odds` and `stake_units` and route their cohorts through `published`. |
| `apps/command-center/src/lib/data/analytics.test.ts` | +283 / -0 | **New.** 21 tests over pricing, cohort statistics, attribution, Track Only exclusion, and the agreement between this app's two American-odds converters. |
| `apps/command-center/src/app/performance/page.tsx` | +90 / -26 | Drops the drifted local `Stats` copy for the producer's type. Adds `pct` / `pctTone`, which render a null ROI as an em dash. Adds the **Published Record by Capper** card (per-capper beside the Unit Talk aggregate) and the **Track Only (internal evidence — not published)** card. Renders net units, units staked and an unpriced note. |
| `apps/command-center/src/components/ui/StatCard.tsx` | +21 / -7 | `value` accepts `null` and renders an em dash instead of driving the counter animation to 0. |
| `apps/command-center/src/lib/command-center-data.ts` | +11 / -3 | `CommandMetric.value` and `scoreBands[].roiPct` widened to `number | null`; the approved-delta metric passes the null through rather than coercing it. |
| `apps/command-center/src/app/intelligence/page.tsx` | +1 / -1 | A score band with no measurable ROI renders `— ROI`. |
| `apps/command-center/src/app/intelligence/calibration/page.tsx` | +8 / -2 | The approved-vs-denied delta renders `—` and a `flat` trend when neither cohort could be priced. |
| `apps/command-center/src/lib/data/index.ts` | +2 / -0 | Re-exports `Stats` and the four pure helpers the tests drive. |

Total: **8 files, +677 / -118**. No migrations, no workflow files, no `apps/api`, no contracts, no `scripts/`.

## What this lane deliberately does not do

1. **No second stats ledger.** Nothing is persisted, materialized or cached. Every figure is computed
   from the persisted rows on read, which is what makes it reconcilable against them.
2. **No new odds conversion.** `pickProfitUnits` goes through `americanToDecimal` /
   `isValidAmericanOdds` from `@unit-talk/contracts`, so it reproduces
   `scripts/ops/track-only/stats.ts` → `profitUnits` exactly rather than re-deriving it. A second
   implementation of a money calculation is a second thing that can be wrong. This app already has a
   second converter in `src/lib/odds-math.ts`; rather than pick one and hope, two tests pin the two
   to agree and assert the contracts validation is the stricter of the pair.
3. **No Smart Form change.** The delivery-ui lane type maps a lane's `file_scope_lock` to exactly one
   canonical app root, so the Smart Form half of the T2 objective — "Smart Form must not display
   'Track Only / no member delivery' to a capper whose server-authorized submission is actually
   entering the approval-for-delivery path" — is a separate lane. It also depends on
   `deliveryPosture`, which exists only on the unmerged UTV2-1923 branch.
4. **No delivery authorization.** This surface displays server truth. It grants nothing and changes
   no containment setting.
