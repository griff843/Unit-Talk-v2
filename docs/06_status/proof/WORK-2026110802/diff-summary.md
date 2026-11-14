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

Review round 2 (2026-11-11, commit 8a90b9730):

| File | Change |
|---|---|
| `apps/api/src/smart-form-validation.ts` | P1-A accent-tolerant coverage queries (`accentTolerantPatterns`, `manualPlayerCoverageQueries`, row limit 500, cap 50, any saturation fails closed); P1-B `isPlausiblySamePlayer`; P1-C `assertManualPlayerBoundToPick`; P2-A `assertNoManualPlayerMarkers` at both not-smart-form returns; P3 `assertManualPlayerNameCharacters` (NFC + allow-list) |
| `apps/api/src/smart-form-validation.test.ts` | fixture matches the form payload (statType, overUnder, marketType); ILIKE-emulating mocks; 13 new tests (111-123), F2/F4 tests updated |
| `apps/api/src/clv-service.ts` | `resolveParticipantId` exported for its guard test |
| `apps/api/src/clv-service.test.ts` | test 45 pins the resolver's manual-player guard |

Review round 3 (2026-11-11, commits df3d33296, b7692eaca):

| File | Change |
|---|---|
| `packages/contracts/src/smart-form.ts` | copy of the client player-prop market-key tables; `resolveSmartFormPlayerPropMarketKey`, `smartFormPlayerPropMarketKeysForSport`, `smartFormPlayerPropStatTypes`, `smartFormPlayerPropSports` |
| `apps/api/src/smart-form-validation.ts` | P1-1/P2-4 `catalogPlayerMatch` (`resolves` / `plausible`, near-miss rules, transliteration undone) replaces `isPlausiblySamePlayer`; P2-1 consonant wildcards g l r d t k and oe/ue/ae patterns; P2-2 reversed full-name query (cap 64); P2-3 `PLAYER_NAME_FIELDS` / `PLAYER_ID_FIELDS` binding; P3 `manualPlayerName` persisted to every name field, exact market key, malformed row 503 |
| `apps/api/src/smart-form-validation.test.ts` | 12 new tests (104, 125-135), saturation test split into under-limit control (103) and true saturation (104), refusal regexes accept "may be" |
| `apps/smart-form/test/form-utils.test.ts` | test 55: client and contract market keys identical |

Docs and records: `docs/03_product/smart-form/acceptance-matrix.md` (new resolution row),
`.ops/work/WORK-2026110802.md` (work order, with the PM singleton authorization recorded under Admission),
this proof directory.

Not changed: `apps/api/src/handlers/submit-pick.ts` (the Track Only refusal lives in validation),
`apps/smart-form/lib/form-schema.ts`, `apps/smart-form/test/submission-guard.test.ts` (declared in
scope, not needed). No migration, provider, ingestion, delivery or kill-switch change.

## SHA Binding

Merge SHA: fde68a982a585a3ae7ea8cf12c84f4d3e6b7737c
PR: pending
