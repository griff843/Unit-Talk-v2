# PROOF: UTV2-1910

MERGE_SHA: a23cadea5cff61b344012bab2400bb883c6cb6d6

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-16T01:15:17.292Z
Issue: UTV2-1910
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1910-cc-operator-grading-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1586
Head SHA: 8e44be6d66f98db946708d64cdcbcc3fb7509911
result: pass

## ASSERTIONS:

- [x] `settlePick` sends `operatorGradingContext` on every settlement, so an evidence-plane pick no longer fails `apps/api/src/settlement-service.ts:518` with `OPERATOR_GRADING_CONTEXT_REQUIRED`.
- [x] The attestation parameter is **required**, and an incomplete one is refused locally — naming the missing field — before any request is sent.
- [x] Authentication is resolved before the attestation is examined, so an unauthenticated caller is still refused as unauthenticated rather than as malformed input.
- [x] `evidenceRef` is derived from the attestation (`operator-manual:<observedAt>:<resultSourceUrl>`) rather than the constant `'operator-manual'`, so a correction record is distinguishable from the record it corrects.
- [x] `confidence` is the operator's own choice rather than a hardcoded `'confirmed'`, and `notes` is sent when supplied.
- [x] The client validator is the canonical `validateOperatorGradingContext` imported from `@unit-talk/contracts`, not a fork, so client and server cannot drift.
- [x] `SettlementForm` and `CorrectionForm` collect the attestation and gate submission on its completeness.
- [x] `InlineSettleButton` is deleted rather than given a fabricated attestation; it had zero importers repo-wide.
- [x] The `server-action-guard.test.ts` forged-actor non-vacuity control still reaches the backend for `settlePick`.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no findings)

$ pnpm --filter @unit-talk/command-center test
1..524
# tests 524
# pass 524
# fail 0

$ pnpm test
# tests 6360
# pass 6360
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: operator-ui

$ pnpm verify
not run locally — ci:assert-staging-target cannot succeed off CI; `verify` is
asserted by the required CI check on this PR instead.
```

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: 6360 pass / 0 fail (524 of them in `@unit-talk/command-center`, including 9 new `operator-grading-context` tests)
- [ ] `pnpm verify`: not run locally — the staging-target assertion inside it cannot pass off CI; the required `verify` check on this PR is the binding evidence
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, rules matched `operator-ui`

## Runtime Verification

No runtime proof is claimed and none is owed at T2. This lane changes only
`apps/command-center` client and server-action code; it writes nothing to any
database and adds no migration. The behaviour it repairs is asserted against
the canonical contract validator rather than against a live API, and the live
assertion belongs to the Chiefs production E2E, which follows deployment.

The non-vacuity of the guard suite is the one runtime-shaped claim here and it
was measured rather than asserted: with `settlePick` invoked on two arguments
the control `the authenticated forged-actor cases actually reach the backend`
failed (`not ok 345`, 523/524), and it passes at this head with the attestation
supplied — so the control is demonstrably sensitive to the condition it names.

## Merge SHA Binding

Merge SHA: a23cadea5cff61b344012bab2400bb883c6cb6d6
PR: https://github.com/griff843/Unit-Talk-v2/pull/1586
Approved PR head: 5a1b6f096d2eff123e86484b3c98d10373a9df51
Execution SHA: 8e44be6d66f98db946708d64cdcbcc3fb7509911
