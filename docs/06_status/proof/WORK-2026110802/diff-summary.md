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

PM changes (2026-11-11, commit 234e4983e; scope expansion to `clv-service.ts` PM-approved):

| File | Change |
|---|---|
| `apps/api/src/clv-service.ts` | `computeCLVOutcome` returns `manual_player_coverage_gap` first for a manual coverage-gap pick; `resolveParticipantId` refuses it; `isManualPlayerCoverageGapPick` |
| `apps/api/src/clv-service.test.ts` | 6 tests: name-matched manual pick gets no CLV (both markers, pre-resolved context), controls compute |
| `apps/api/src/smart-form-validation.ts` | alias-token coverage queries (full name first, decisive last-token saturation fails closed); server-stamped provenance and labels; field allow-list, length/word/control-char caps, search-count cap, total search budget |
| `apps/api/src/smart-form-validation.test.ts` | 12 new tests (F2-F4), test 95 updated to the server-stamp semantics |
| `apps/smart-form/lib/form-utils.ts` | `player` added to `manualOverrideFields` with manual provenance; constant typed to the contract |
| `apps/smart-form/app/submit/components/SuccessReceipt.tsx` | uses the shared constant |
| `apps/smart-form/test/form-utils.test.ts`, `apps/smart-form/e2e/manual-player-fallback.spec.ts` | label and constant assertions |

Docs and records: `docs/03_product/smart-form/acceptance-matrix.md` (new resolution row),
`.ops/work/WORK-2026110802.md` (work order, with the PM singleton authorization recorded under Admission),
this proof directory.

Not changed: `apps/api/src/handlers/submit-pick.ts` (the Track Only refusal lives in validation),
`apps/smart-form/lib/form-schema.ts`, `apps/smart-form/test/submission-guard.test.ts` (declared in
scope, not needed). No migration, provider, ingestion, delivery or kill-switch change.

## SHA Binding

Merge SHA: pending merge
PR: pending
