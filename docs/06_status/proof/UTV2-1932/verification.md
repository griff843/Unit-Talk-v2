# PROOF: UTV2-1932 Verification

MERGE_SHA: 5712b7c8187e93ffc0b3e7b12f9bc11caff7e6bb

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T15:05:00.000Z
Issue: UTV2-1932
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1932-command-center-dim5-operator-fields
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1606
Head SHA: ee665990d6461ad09a8886112b66ea63c5a99ffe
Execution SHA: ee665990d6461ad09a8886112b66ea63c5a99ffe
Diff base: 5a66810cfe5b8635829ca5a8243143ec07dd8602
result: pass

## Summary

Five operator-visible gaps in the Command Center were closed, all in the same direction:
**an absence was being rendered as if it were a value, or not rendered at all.** The
Picks Explorer showed no score, routing or edge-source column; `/held` redirected to a
page that structurally excludes held picks; the approvals cockpit did not say who was
holding a pick; the held-queue count was an estimate presented without qualification;
and CLV — which is null on every settled pick in production today, because closing-line
capture depends on a provider that is deliberately off — rendered as a bare dash
indistinguishable from "this column does not apply".

The CLV rendering was extracted verbatim from `app/picks/[id]/page.tsx` into
`lib/clv-summary.ts` so the settlement ops surface renders the same verdict rather than a
second, quietly divergent one, and given the first unit tests that file has ever had.

## ASSERTIONS:

Operator-surface completeness

- [x] The Picks Explorer renders Score, Routing and Edge-source columns, each naming the
      reason when the underlying value is absent rather than printing an empty cell.
- [x] `/held` resolves to the surface that actually contains held picks. `getReviewQueue`
      applies `.or('review_decision.is.null,review_decision.neq.hold')` at
      `lib/data/queues.ts:345`, while `getHeldQueue` applies `.eq('review_decision', 'hold')`
      at `:395`; `/operations/approvals` consumes `getHeldQueue`, so the previous redirect
      sent an operator to a page whose filter excludes precisely what they asked for.
- [x] The approvals cockpit renders `heldBy`, so a held pick names its holder.
- [x] The held-queue count is reported as `exact`, not `estimated`. It is derived from the
      same filtered query that produces the rows, so the two can no longer disagree.

CLV truthfulness

- [x] `renderClvSummary()` is a single definition, imported by both the pick-detail page and
      the settlement ops surface. There is no second copy to drift.
- [x] Every no-number branch names *why* there is no number — `missing (<reason>)`, the
      recorded `clvStatus`, or `missing` — and never a bare dash.
- [x] A measured CLV of exactly `0.00%` renders as a measurement, not as an absence. This is
      the distinction the old falsy check erased.
- [x] A CLV measured against the opening line says so, via the ` via opening fallback`
      suffix, so a fallback measurement is never read as a closing-line measurement.
- [x] `isClvUnresolved()` tests `clvPercent == null` — the one predicate that separates
      "no closing line was ever captured" from "the captured value was zero".

Scope and safety

- [x] No pipeline, scoring, settlement or delivery behaviour is changed. Every file touched
      is under `apps/command-center`, which is read-only against Supabase and writes only
      through `apps/api`.
- [x] No containment setting, kill switch, delivery target or runtime flag is touched, and
      the diff contains no migration.
- [x] Provider-dependent capability is **deferred, not faked**: CLV stays null on all six
      settled picks. This lane makes the null legible; it does not manufacture a number.

## EVIDENCE:

```
$ pnpm lint
exit 0  (eslint . --cache, no output)

$ pnpm type-check
exit 0  (pnpm exec tsc -b tsconfig.json, no diagnostics)

$ pnpm test
exit 0
  5928 lines matching '^ok '
     0 lines matching '^not ok '
   104 suite blocks, all '# fail 0'

$ pnpm exec tsx --test apps/command-center/src/lib/clv-summary.test.ts
# tests 7
# pass 7
# fail 0
# skipped 0

$ pnpm verify
exit 1 — refused by staging isolation, not by this diff:
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL.
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the
  staging-ci GitHub environment with CI_SUPABASE_* credentials.
verify:static and verify:commands both pass; this is the correct local outcome. The
authoritative full-tree result is the required `verify` context on PR #1606.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16
Rules matched: operator-ui
```

## MUTATION CONTROLS:

Each mutation names one condition and is expected to break exactly the test that asserts it.

| # | Mutation | Observed | Verdict |
|---|---|---|---|
| — | unmutated baseline | 7 tests, 7 pass, 0 fail | pass |
| 1 | replace `clvPercent != null` with a falsy check (`!settlement.clvPercent`) | `not ok 4 - zero CLV is a measurement, not an absence` — 6 pass / 1 fail | fails on the named condition |
| — | restored | 7 tests, 7 pass, 0 fail | pass |
| 2 | drop the ` via opening fallback` suffix | `not ok 2 - a CLV measured against the opening line says so` — 6 pass / 1 fail | fails on the named condition |
| — | restored, `git diff` = 0 lines | 7 tests, 7 pass, 0 fail | pass |

Mutation 1 is the one that matters: it is the exact defect the extraction was written to
prevent, and without the new test it would have been invisible — a real `0.00%` CLV would
have rendered as "missing" and an operator would have read a measured push as an absent
measurement.

## Verification

- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 5,928 ok / 0 not ok / 104 suite blocks with 0 failures
- [x] `pnpm verify`: exit 1 locally, refused by `ci:assert-staging` before any assertion
      about this diff; authoritative result is the required `verify` context on #1606
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS,
      16 changed files, rules matched `operator-ui`, no required artifact missing
- [x] `pnpm test:db`: not run locally — same staging-isolation refusal. This lane writes
      nothing and reads nothing new from the database; the CI-produced
      `ci-db-proof-receipt/v2` verified inside the required `verify` context is the authority.

## Runtime Verification

Not applicable, and not silently skipped. This is a T2 `delivery-ui` lane whose entire diff
is server-rendered presentation over an existing read path — no new query, no new write
surface, no new API route, no schema change. The production facts the surfaces render were
measured independently and are recorded in `diff-summary.md`: CLV is null on all six settled
picks in the governed cohort.

## STOP CONDITIONS ENCOUNTERED:

- `pnpm verify` and `pnpm test:db` cannot complete in this checkout. `ci:assert-staging`
  refuses any target that is not `xskgrzbteyqdufktjrjx`, and the local `SUPABASE_URL` is the
  containment placeholder. Not worked around, not bypassed: recorded, with CI named as the
  authority.
- No reserved decision was reached by this lane, and none was requested.

## Sign-off

Executor: Claude (Opus 5, 1M context)
Every number above was measured at `ee665990d6461ad09a8886112b66ea63c5a99ffe`, not recalled.

## Merge SHA Binding

Merge SHA: 5712b7c8187e93ffc0b3e7b12f9bc11caff7e6bb
PR: https://github.com/griff843/Unit-Talk-v2/pull/1606
Approved PR head: pending merge
Execution SHA: ee665990d6461ad09a8886112b66ea63c5a99ffe
