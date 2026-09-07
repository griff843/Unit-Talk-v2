# PROOF: UTV2-1853

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-07T19:24:49.550Z
Issue: UTV2-1853
Tier: T2
Lane type: runtime
Branch: claude/utv2-1853-smart-form-api-numeric-guardrails
PR URL: 1531
Head SHA: 208446676c06e86e30faaafed76919a8f4508097
result: static

## ASSERTIONS:

- [x] The API enforces the numeric guardrails the operator-submission contract already
      specifies, on the server, where the client cannot bypass them.
      `SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md:172-215` sets units 0.5-5.0 step 0.5,
      American odds integer with magnitude 100-50000, and line magnitude <= 999.5. Those
      exact bounds are now constants in `apps/api/src/smart-form-validation.ts` and are
      asserted from the constants, not from copied literals.
- [x] The guard BOUNDS values; it does not newly REQUIRE them. `odds` and `stakeUnits` are
      declared `?: number | undefined` in `packages/contracts/src/submission.ts:21-22` and
      read through `readOptionalNumber` in `apps/api/src/handlers/submit-pick.ts:153`.
      An earlier revision of this lane asserted presence and turned three existing
      `http-integration.test.ts` cases red with "odds is required on a Smart Form
      submission". That was a field-presence contract change smuggled into a bounds lane
      and it was reverted. Making either field mandatory remains a change to
      `packages/contracts/src/submission.ts` and is not made here.
- [x] `line` stays optional for the same reason and is bounded only when present: a
      moneyline pick legitimately carries none, which is what the contract's
      "Not required when | Moneyline" row (`:211`) means.
- [x] `metadata.capperConviction` is bounded to integer 1-10 per
      `T1_SMART_FORM_V1_CONTRACT.md:91-95`. Presence is enforced by the existing schema
      path and is deliberately not re-asserted here.
- [x] Containment untouched. `git diff origin/main...HEAD` filtered on `trackOnly` and
      `distributionMode`, with the proof directory excluded, returns no matches: this diff
      adds, removes and modifies none of them.
- [x] Mutation-proven with three mutations, each turning a distinct set of assertions red
      against a 74/74 green baseline. See EVIDENCE.

## EVIDENCE:

```
$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm test
# tests 6035
# pass 6035
# fail 0
# skipped 0
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: (none) - no R-level artifacts required for this diff

$ pnpm verify
Not obtainable locally: it refuses at test:live-db under containment, where local.env
points every Supabase client at http://127.0.0.1:1 by design. The binding receipt is the
required `verify` check on this exact head, which is green:
  verify success
  https://github.com/griff843/Unit-Talk-v2/actions/runs/34153950859/job/101844431938
  head 208446676c06e86e30faaafed76919a8f4508097

$ pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts   # baseline
# tests 74
# pass 74
# fail 0

MUTATION 1 - unwire the call site (assertSmartFormNumericBounds(payload) -> void assertSmartFormNumericBounds)
# tests 74
# pass 65
# fail 9

MUTATION 2 - delete the odds finite check (smart-form-validation.ts:746-748)
# tests 74
# pass 73
# fail 1

MUTATION 3 - widen SMART_FORM_UNITS_MAX from 5 to 999
# tests 74
# pass 72
# fail 2
```

Mutation 1 is the one that matters most: without it the entire guard could be deleted while
every behavioural test stayed green, which is the failure mode the executor-result-validator
duplication produced. Mutations 2 and 3 show the individual bounds are each load-bearing
rather than jointly asserted by one broad case.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: 6035 tests, 6035 pass, 0 fail, exit 0
- [x] `pnpm verify`: green as the required check on this head (run 34153950859); not
      obtainable locally under containment, see EVIDENCE
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Runtime Verification

Static proof. This lane changes a pure validation function and its call site; it performs
no I/O, reads no database and touches no delivery path, so there is no runtime behaviour to
observe against live data that the unit suite does not already cover. The mutation results
above are the execution evidence.

## Known Gaps

- This lane does NOT repair the Smart Form submission blocker. A structured-fallback or
  canonical submission still fails before persistence for reasons this diff does not
  address; those are the reference-data identity defects tracked separately. Bounding the
  numerics is necessary and is not sufficient.
- It does NOT verify the browser -> API -> persisted-pick flow. No CI workflow runs
  `apps/smart-form/e2e/`, so no green check on this PR is evidence about it.
- It does NOT re-prove Track Only non-delivery. Those guards are unchanged and already
  mutation-tested; this diff touches none of them.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1531
Approved PR head: pending merge
Execution SHA: 208446676c06e86e30faaafed76919a8f4508097
