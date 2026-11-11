# Diff summary: WORK-2026110802

Implementation files, from `git diff --stat bbd5f6bb9..b64849542 -- apps/ packages/` (excludes
`docs/**` and `.ops/**`): 9 files changed, 1210 insertions(+), 18 deletions(-).

| File | Change |
|---|---|
| `packages/contracts/src/smart-form.ts` | optional `CanonicalParticipantResolution.manualPlayer` (`ManualPlayerCoverageGap`), `manualPlayerProvenance` constant |
| `apps/api/src/smart-form-validation.ts` | `assertManualPlayerAdmissible` (shape, mutual exclusion, provenance, provider-offer and Track Only refusals) and `verifyManualPlayerCoverageGap` (bounded `searchPlayers` proof; covered name refused; search error or timeout is a retryable 503) |
| `apps/api/src/smart-form-validation.test.ts` | 16 WORK-2026110802 tests (accept shapes, refusals, retryable search failure) |
| `apps/smart-form/lib/form-utils.ts` | `canOfferManualPlayer`, `withManualPlayer`, `playerProvenance` on the payload, guard codes mirroring each server rule |
| `apps/smart-form/test/form-utils.test.ts` | 9 WORK-2026110802 tests (offer, guards, exact payloads for the three shapes) |
| `apps/smart-form/app/submit/components/BetForm.tsx` | player search state, "Player not found: enter manually" control, guard inputs, resolution built with `withManualPlayer` |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | slip labels a manual player (no provider verification, no CLV) |
| `apps/smart-form/app/submit/components/SuccessReceipt.tsx` | receipt labels the player "(manually entered)" |
| `apps/smart-form/e2e/manual-player-fallback.spec.ts` | operator-run browser spec: three shapes row-asserted, errored search refused |

Docs and records: `docs/03_product/smart-form/acceptance-matrix.md` (new resolution row),
`.ops/work/WORK-2026110802.md` (work order, with the PM singleton authorization recorded under Admission),
this proof directory.

Not changed: `apps/api/src/handlers/submit-pick.ts` (the Track Only refusal lives in validation),
`apps/smart-form/lib/form-schema.ts`, `apps/smart-form/test/submission-guard.test.ts` (declared in
scope, not needed). No migration, provider, ingestion, delivery or kill-switch change.

## SHA Binding

Merge SHA: pending merge
PR: pending
