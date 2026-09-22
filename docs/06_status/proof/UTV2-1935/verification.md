# PROOF: UTV2-1935 Verification

MERGE_SHA: e71c455aaef0232fb1c8c94d0f80aa94e6dd6118

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T16:35:00.000Z
Issue: UTV2-1935
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1935-review-queue-suppression-reason
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1608
Head SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
Execution SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
Diff base: c79a5bb2a2a9113222459983a0c55c5720a2045a
result: pass

## Summary

Two Dimension 5 gaps left standing by #1606, both of the same kind: a surface that
**cannot** state a fact rather than one that chooses not to.

The review queue never selected `promotion_reason`, so a suppressed pick on `/review` was
unexplainable at the query level — no rendering change could have fixed it. `/held`, after
#1606, redirected to a cockpit that merges the held population with two other queues and drops
the three fields that make a hold actionable: who placed it, how old it is, and why.

The reason-rendering logic is extracted to `lib/suppression.ts` rather than copied, so the
review queue and `/held` cannot drift from the `RoutingCell` semantics #1606 established in the
picks explorer. The extraction is what makes the behaviour testable at all: the module is pure
and imports nothing from `lib/data/*`, which is also what lets a client component use it.

## ASSERTIONS:

Reason completeness

- [x] `promotion_reason` is selected. `QUEUE_SELECT` in `lib/data/queues.ts` now lists it beside
      the `promotion_status` it already requested, and both `mapReviewPick` and the `getHeldQueue`
      row mapper read it through the existing `asStringOrNull` accessor.
- [x] A suppressed pick with a recorded reason renders that reason on `/review`.
- [x] A suppressed pick with **no** usable reason renders `no reason recorded` in rose — a stated
      defect, not an em dash. `NO_REASON_RECORDED !== '—'` is itself asserted, so the label cannot
      be quietly downgraded to a glyph.
- [x] A whitespace-only reason counts as blank. This is the case a naive `reason != null` check
      passes while showing an operator three spaces, and it is the distinction the contract's
      "non-blank" wording names.
- [x] A non-suppressed pick is never reported as owing a reason, so the defect colour means one
      thing only.
- [x] An unreadable or non-string status **fails open**. Failing closed there would invent a
      suppression the row does not claim and mark every pick whose status failed to load.

Held queue

- [x] `/held` resolves to a page whose query is `getHeldQueue`, which applies
      `.eq('review_decision', 'hold')` — not to any surface that merges or excludes the held
      population. `/review` still excludes held picks by construction via
      `.or('review_decision.is.null,review_decision.neq.hold')`, which is why the pre-#1606
      redirect was wrong and remains wrong.
- [x] The page renders `heldBy`, `ageHours` and `holdReason` — the three fields `getHeldQueue`
      already computed and no surface displayed.
- [x] A failed load is not rendered as an empty queue. A throw or a `degraded` result renders
      `DegradedState` naming the cause; a genuine empty result says the load succeeded. An
      operator can distinguish "nothing is held" from "the held queue could not be read".

Scope and safety

- [x] No pipeline, scoring, settlement or delivery behaviour is changed. Every file touched is
      under `apps/command-center`, which reads Supabase directly and writes only through
      `apps/api`.
- [x] No containment setting, kill switch, delivery target or runtime flag is touched, and the
      diff contains no migration and no server action.
- [x] No provider-dependent value is manufactured. `promotion_reason` is written by the scoring
      path today; this lane makes no claim about CLV, closing lines or automated grading, which
      remain explicitly deferred under the standing SGO sequencing directive.

## EVIDENCE:

```
$ pnpm lint
exit 0  (eslint . --cache, no output)

$ pnpm type-check
exit 0  (pnpm exec tsc -b tsconfig.json, no diagnostics)

$ pnpm test
exit 0
  5939 lines matching '^ok '
     0 lines matching '^not ok '
   104 suite blocks, all '# fail 0'

$ pnpm exec tsx --test apps/command-center/src/lib/suppression.test.ts
# tests 11
# pass 11
# fail 0
# skipped 0

$ pnpm verify
exit 1 — refused by staging isolation, not by this diff:
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL.
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the
  staging-ci GitHub environment with CI_SUPABASE_* credentials.
verify:static and verify:commands both pass; this is the correct local outcome. The
authoritative full-tree result is the required `verify` context on PR #1608.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: operator-ui
```

## MUTATION CONTROLS:

Each mutation names one condition and is expected to break exactly the test that asserts it.
`suppression.ts` was restored from a byte-copy after each, and the baseline re-run to confirm it.

| # | Mutation | Observed | Verdict |
|---|---|---|---|
| — | unmutated baseline | 11 tests, 11 pass, 0 fail | pass |
| 1 | replace the trim-based blank check with a naive `promotionReason != null` | `not ok 4 - a whitespace-only reason is blank…` and `not ok 5 - an empty-string reason is treated the same as a missing one` — 9 pass / 2 fail | fails on the named condition |
| — | restored | 11 tests, 11 pass, 0 fail | pass |
| 2 | drop the `suppressed &&` guard from `missingReason` | `not ok 6 - a non-suppressed pick owes no reason…` and `not ok 9 - a missing or non-string status is not silently treated as suppressed` — 9 pass / 2 fail | fails on the named condition |
| — | restored | 11 tests, 11 pass, 0 fail | pass |
| 3 | invert the status predicate so anything not `promoted` is suppressed (fail-closed) | `not ok 6`, `not ok 7 - a non-suppressed pick that happens to carry a reason…`, `not ok 9` — 8 pass / 3 fail | fails on the named condition |
| — | restored | 11 tests, 11 pass, 0 fail | pass |

Mutation 1 is the one that matters. It is the exact shape a reviewer would write by hand — a
non-null check on a nullable text column — and it satisfies the contract's wording while showing
an operator nothing. Without cases 4 and 5 the regression would be invisible.

Mutation 3 records the direction of the fail-open decision deliberately, because fail-open is
normally the wrong default in this codebase. Here the population is inverted: the value being
classified is not a safety control but a display status, and treating an unreadable status as
suppressed would mark every such pick as a data defect. The safety controls this surface sits
beside — the kill switch, `isTrackOnlyPickMetadata` — remain fail-closed and are untouched.

## Verification

- [x] `pnpm lint`: exit 0
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 5,939 ok / 0 not ok / 104 suite blocks with 0 failures
- [x] `pnpm exec tsx --test apps/command-center/src/lib/suppression.test.ts`: 11 tests, 11 pass,
      0 fail, 0 skipped
- [x] `pnpm verify`: exit 1 locally, refused by `ci:assert-staging` before any assertion about
      this diff; the authoritative result is the required `verify` context on #1608
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, 8 changed files, rules matched `operator-ui`,
      no required artifact missing
- [x] `pnpm test:db`: not run locally — same staging-isolation refusal. This lane writes nothing
      and adds one column to an existing read; the CI-produced `ci-db-proof-receipt/v2` verified
      inside the required `verify` context is the authority.

## Runtime Verification

Not applicable, and not silently skipped. This is a T2 `delivery-ui` lane whose entire diff is
server- and client-rendered presentation over an existing read path. The one data-layer change is
a single additional column in a `select` that already ran; there is no new query, no new write
surface, no new API route and no schema change.

The production fact the surfaces render was measured independently rather than assumed: the
governed pick cohort is identified by `metadata ? 'distributionMode'`, and `promotion_reason` is
populated by the scoring path that already writes `promotion_status`. This lane renders what is
there; it computes nothing.

## STOP CONDITIONS ENCOUNTERED:

- `pnpm verify` and `pnpm test:db` cannot complete in this checkout. `ci:assert-staging` refuses
  any target that is not `xskgrzbteyqdufktjrjx`, and the local `SUPABASE_URL` is the containment
  placeholder. Not worked around, not bypassed: recorded, with CI named as the authority.
- No reserved decision was reached by this lane, and none was requested. No containment setting,
  provider key or delivery target was read, changed or depended upon.

## Sign-off

Executor: Claude (Opus 5, 1M context)
Every number above was measured at `09b8396bfe5431a2da00a469aadf5f8b7cf81a6d`, not recalled.

## Merge SHA Binding

Merge SHA: e71c455aaef0232fb1c8c94d0f80aa94e6dd6118
PR: https://github.com/griff843/Unit-Talk-v2/pull/1608
Approved PR head: pending merge
Execution SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
