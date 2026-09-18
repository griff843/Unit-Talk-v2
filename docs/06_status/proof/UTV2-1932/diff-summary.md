# PROOF: UTV2-1932 Diff Summary

MERGE_SHA: pending merge

Generated at: 2026-09-18T14:10:00.000Z
Issue: UTV2-1932
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1932-command-center-dim5-operator-fields
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1606
Head SHA: 5ab1f83946766f005ef3b9d847f630342db5f408
Execution SHA: 5ab1f83946766f005ef3b9d847f630342db5f408
Diff base: 3a07f41b0a09fddb924e964e255e16b6c8e0a80b
result: pass

## Git Diff Stat

```
 apps/command-center/src/app/held/page.tsx          | 12 ++-
 .../src/app/operations/approvals/page.tsx          | 12 ++-
 apps/command-center/src/app/picks/[id]/page.tsx    | 27 +------
 apps/command-center/src/app/settlement/page.tsx    | 13 ++-
 .../src/components/PicksExplorerClient.tsx         | 92 +++++++++++++++++++++-
 apps/command-center/src/lib/clv-summary.test.ts    | 63 +++++++++++++++
 apps/command-center/src/lib/clv-summary.ts         | 52 ++++++++++++
 apps/command-center/src/lib/data/picks.ts          |  2 +-
 apps/command-center/src/lib/data/queues.ts         | 14 +++-
 apps/command-center/src/lib/data/results-ops.ts    | 35 +++++++-
 10 files changed, 286 insertions(+), 36 deletions(-)
```

## Why this lane exists

Readiness **Dimension 5 — Operator Decision Support** is the largest block of the six-dimension
T1 contract that is **fully provider-independent**. Under the standing SGO sequencing directive
it is therefore closable now, while Dimensions 2, 3 and 6 stay explicitly deferred.

`docs/05_operations/READINESS_MEASUREMENT_2026-09-14.md` recorded Dimension 5 as FAIL with the
reason "none is deployed … an operator cannot reach any of the five surfaces". That reason is
**no longer true** — the Command Center is enabled and deployed (`Deploy` run `35289985486`) and
operators wrote through it on 2026-09-18. The measurement doc is corrected under UTV2-1934.

What remained were four concrete surface gaps: a decision field an operator could not see, a
routing refusal with no visible reason, a queue whose page redirected away from itself, and a
settlement table that could not distinguish *unmeasured* from *zero*. This lane closes those four.

## What changed, and why

Every change is read-only presentation over data the database already holds. **No write path, no
mutation, no route handler, no server action and no delivery, approval or containment control is
touched by this diff.**

### 1. Picks Explorer showed no decision inputs

`PicksExplorerClient.tsx` rendered eight columns, none of which carried the fields an operator
actually decides on. It now renders three more, after Status:

- **Score** — `ScoreCell` prints the numeric score, and where there is none prints
  `not scored` for a pick whose `score_status` is `not_eligible` or `suppressed` and `unscored`
  otherwise. A blank cell would read as zero; these two words do not.
- **Routing** — `RoutingCell` prints `promotion_target` (or `unrouted`) with `score_status`
  beneath it. When the status is `suppressed` it prints `promotion_reason`, and when the reason
  is **absent it prints `no reason recorded` in red** rather than nothing. A suppression with no
  recorded reason is a data defect, and the surface now says so instead of hiding it.
- **Edge source** — `buildScoreInsight` already computed `edgeSource` and a `reliabilityTone`;
  the tone now drives the cell's colour, and the `title` names the raw `realEdgeSource` value, or
  says `no edge source recorded on this pick` when there is none.

`promotion_reason` was added to the `searchPicks` select in `lib/data/queues.ts` and to the
suppressed-pick select in `lib/data/picks.ts` — it was never read before. `colSpan` moved 8 → 11
and the table min-width 900px → 1180px so the three new columns do not collapse the layout.

### 2. `/held` redirected an operator away from the held queue

`apps/command-center/src/app/held/page.tsx` redirected to `/review`. `getReviewQueue` filters
`.or('review_decision.is.null,review_decision.neq.hold')` (`lib/data/queues.ts:345`) — **by
construction `/review` cannot contain a held pick**. So the one
URL named after the held queue was the one place guaranteed not to show it.

It now redirects to `/operations/approvals`, the v2 approvals cockpit, which is the surface that
actually consumes `getHeldQueue`. The docblock records why, so the next reader does not
"simplify" it back to `/review`.

### 3. The approvals cockpit did not say who held a pick

`CockpitRow` carried no `heldBy`. The held rows now carry it and the Queue cell renders
`by <operator>` beneath the queue name. Held rows are the only rows that have one; the review and
suppressed row-builders set it to `null` explicitly rather than leaving it undefined.

### 4. The held-queue count was an estimate presented as a number

`getHeldQueue` requested `{ count: 'estimated' }` — a PostgREST planner estimate. An operator
reading "12 held" from a planner estimate is reading a guess. It is now `{ count: 'exact' }` and
goes through `readAuthoritativeCount`, which fails closed rather than returning a quiet zero.

### 5. Settlement could not distinguish "CLV is zero" from "CLV was never measured"

`renderClvSummary` lived inside `app/picks/[id]/page.tsx`, so only the single-pick detail view
could render CLV; the settlement table had no CLV column at all. It is extracted verbatim to
`lib/clv-summary.ts` (no behaviour change — the two call sites at `:547` and `:573` are
untouched) and joined there by `isClvUnresolved()`.

`results-ops.ts` now selects the settlement `payload` and maps five CLV fields off it
(`clvPercent`, `beatsClosingLine`, `isOpeningLineFallback`, `clvStatus`, `clvUnavailableReason`)
through `readClvFields`, which reads each with a typed accessor and yields `null` rather than
coercing. The settlement page renders a CLV column that is muted when unresolved and `cc-num`
when measured, and an unsettled result now reads `unsettled` instead of an em dash.

**This is presentation of a provider-dependent value, not a claim to have measured it.** All six
settled governed picks carry `clvPercent = null` today and will keep doing so until the provider
decision resolves. The column exists so that when CLV does arrive, a zero reads as a measurement
and a null reads as an absence — which is precisely the distinction the old em dash destroyed.

## ASSERTIONS:

- [x] A measured CLV renders with its line verdict. Asserted by `renders a measured CLV with its
      beats-closing-line verdict` (`apps/command-center/src/lib/clv-summary.test.ts`).
- [x] An opening-line fallback is labelled as one and not silently presented as closing-line CLV.
      Asserted by `labels an opening-line fallback`.
- [x] **Zero CLV is a measurement, not an absence.** Asserted by `treats a zero CLV as a measured
      value, not an absence`, which requires `isClvUnresolved({ clvPercent: 0, ... })` to be
      `false`. This is the assertion the em dash could not make.
- [x] A null CLV is unresolved and carries its reason where one exists. Asserted by `reports an
      absent CLV with its recorded reason`.
- [x] A missing settlement row is unresolved rather than an error. Asserted by `treats a missing
      settlement as unresolved`.
- [x] The production shape today — every settled pick unresolved — renders without a false
      number. Asserted by `production shape today: every settled pick is unresolved`.
- [x] `renderClvSummary` moved without behaviour change: the extracted function is byte-identical
      to the one removed from `app/picks/[id]/page.tsx`, and both call sites are unchanged.
- [x] `/held` no longer routes to a surface that structurally excludes held picks.
      `getReviewQueue` applies `.or('review_decision.is.null,review_decision.neq.hold')` at
      `lib/data/queues.ts:345`, while `getHeldQueue` applies `.eq('review_decision', 'hold')` at
      `:395`; `/operations/approvals` consumes
      `getHeldQueue`.
- [x] The held-queue total is an exact count read through `readAuthoritativeCount`, not a
      planner estimate.
- [x] A suppression with no recorded reason is displayed as `no reason recorded`, not as an empty
      cell.
- [x] **Nothing in this diff writes.** No server action, route handler, mutation, kill switch,
      approval transition, containment flag or delivery target appears in the change. `git diff`
      contains no occurrence of `SYNDICATE_MACHINE_MODE`, `delivery_kill_switch`,
      `_enabled_targets` or `awaiting_approval`.
- [x] The CSS utility classes the new cells use exist: `.cc-num`
      (`apps/command-center/src/app/globals.css:98`) and `.cc-text-muted` (`:145`) — distinct
      from the `--cc-text-muted` custom properties at `:22` and `:65`.

## EVIDENCE:

See `verification.md` in this bundle for the measured command output, the mutation drill and the
Dimension 5 position this lane leaves behind.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1606
Approved PR head: pending merge
Execution SHA: 5ab1f83946766f005ef3b9d847f630342db5f408
