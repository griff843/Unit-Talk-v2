# PROOF: WORK-2026110802

MERGE_SHA: pending merge

> `post-merge-lane-close.yml` binds the merge SHA; it is never written here by hand.

Issue: WORK-2026110802
Tier: T1
result: pass (static and browser evidence below; staging DB proof runs in CI only, see Runtime Verification)

## Summary

Adds the participant-resolution rung "canonical teams + one manually entered player" (structured
team fallback, `eventId: null`, team sports) as a server-verified, Track Only only path. Original
code head under test: b64849542b6964eb7f23fb97ed6c64b06effa317. PM CHANGES REQUIRED (2026-11-11)
fixes: commit 234e4983e, synced with main as 4361dd6efaedf188b2dea309ca39e4b48dc72987 (the head every
result in "PM changes" below was measured on). The PM approved expanding the lane scope to
`apps/api/src/clv-service.ts` and its focused tests for finding 1. Independent review round 2
(CHANGES REQUIRED at 3fbe5b3ca) fixes: commit 8a90b9730, synced with main as
f40e33cc5ce89c81704ba1f23a305b51f5edefcb (the sync added only `docs/06_status/readiness/readiness-score.json`);
results in "Review round 2" below. Independent review round 3 (CHANGES REQUIRED at bc8037946) fixes:
commits df3d33296 (code) and b7692eaca (one test renamed); main was already merged, no sync needed;
results in "Review round 3" below.

## ASSERTIONS:

- [x] Herro, Burries (NBA) and Dulcich (NFL) shapes are accepted as Track Only with canonical teams and a manual player (api tests 83-85; browser tests 1-3).
- [x] A manual player whose name resolves to a canonical player is refused, naming the match (api test 86).
- [x] A player search error or timeout is a retryable 503 `SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE` and never a recorded gap (api tests 87, 88).
- [x] `delivery-eligible` with `manualPlayer` is refused (`SMART_FORM_MANUAL_PLAYER_TRACK_ONLY_REQUIRED`) with or without a server delivery authorization (api test 89).
- [x] `manualPlayer` with `player`, with an event id, in a non-team sport, with a non-null canonical id, with a flat `playerId`, with a provider offer, or on the all-manual resolution is refused; a client `playerProvenance` claim without a manual player is refused (api tests 90-97).
- [x] PM 1: a manual coverage-gap pick never receives CLV, even when its typed name equals a canonical participant with a priced offer, on the name-fallback and the pre-resolved-context paths; normal picks unchanged (clv tests 39-44).
- [x] PM 2: punctuation/alias-token/confusable spellings of a covered player are refused; the full-name query runs first; a saturated decisive search fails closed (api tests 99-103).
- [x] PM 3: the server stamps `playerProvenance` (contract constant), `manualEntry: true` and `player` in `manualOverrideFields`, overwriting the client; the client builds the same labels and its constant is the contract value (api tests 104-105; smart-form tests 47-49, 52-54; browser tests 1-3).
- [x] PM 4: strict `manualPlayer` field allow-list, 80-char and 6-word name caps, a search-count cap (12, raised to 50 in round 2) and a total search budget; budget exhaustion or a malformed response is a retryable 503 (api tests 106-110).
- [x] R2 P1-A: ASCII spellings of accented catalog names (Munoz, Jokic, Stutzle, Schroder, Slafkovsky, Gimenez, Ramirez, Doncic) are refused as covered via accent-tolerant ILIKE patterns; queries carry only `[a-z0-9_%]`; any saturated search (500 rows) without a covering row fails closed (api tests 111-114).
- [x] R2 P1-B: reordered, concatenated, decorated (team, jersey, parenthetical, nickname), initialed and generational-suffix spellings are refused as covered; distinct players sharing one name part are still gaps (api tests 115-116).
- [x] R2 P1-C: a manual player requires a player-prop market, a catalog statType, the form-built selection naming only that player, and a matching flat `metadata.player` (api tests 117-120).
- [x] R2 P2-A: `playerProvenance` / `participantResolution.manualPlayer` are refused (422) on any non-Smart-Form submission (api test 121).
- [x] R2 P3: displayName must be NFC and within a Latin/digit/punctuation allow-list (invisible, homoglyph, compatibility characters refused); the accepted name is persisted as validated (api tests 122-123); the CLV resolver's own manual-player guard is pinned (clv test 45).
- [x] R3 P1-1: near misses of a covered player are refused with "may be canonical player": surname within one edit or a 4+ letter prefix or reduced to an initial beside the exact given name (Tatem, Tatumm, Tatums, Tatu, Antetokoumpo, "Jayson T.", "Giannis A"); given name a 3+ letter prefix pair, within one edit, or within one edit of a 3+ letter prefix beside the exact surname (Steph, Stef, Cam, Matt, Nic, Nick, Herb, Jay, Jason); two-letter full initials ("HS Kim"); controls (Jaylen Tatum, Jalen vs Jaylin, A.J. Johnson vs Andre Johnson) remain gaps (api tests 125-128).
- [x] R3 P2-1: g l r d t k (accented forms) are wildcarded; German oe/ue/ae patterns and matching (Poeltl, Mueller, Oezil, Oedegaard, Schroeder) refuse the umlauted catalog players; Dogus/Ondrej are found only through the new wildcards (api test 130).
- [x] R3 P2-2: the reversed full-name query finds "Andrew Wu" for "Wu A" (api test 131).
- [x] R3 P2-3: `player`, `playerName`, `participantName` must be the manual player if present; `playerId`, `participantId`, `providerParticipantId` must be absent or null (api test 132).
- [x] R3 P2-4: only an exact name says "resolves to"; near misses and initials say "may be"; several initials refuse only when they equal ALL the catalog player's given initials (api tests 127-129).
- [x] R3 P3: the trimmed, space-collapsed name is persisted to `manualPlayer.displayName` and each string flat name field (api test 133); the market must equal the contract player-prop key for the sport and stat, kept identical to the client table by a parity test (api test 134; smart-form test 55); a malformed search row is a retryable 503 with no stamp (api test 135); the saturation test now exceeds the 500-row limit and expects 422 `SMART_FORM_MANUAL_PLAYER_UNVERIFIABLE` (api test 104; test 103 is the honest under-limit control).
- [x] The teams beside a manual player are verified exactly as for any structured fallback (api test 98).
- [x] The client offers manual entry only after a definitive not-found; an errored or unrun search keeps the refusal (smart-form tests 43-46; browser test 4).
- [x] The client payload for each shape carries canonical teams, `manualPlayer`, Track Only and `playerProvenance: manual-coverage-gap` (smart-form tests 47-51).
- [x] The persisted pick carries real away/home/team ids, `playerId: null`, `participantId: null`, `selectedOffer: null`, `playerProvenance: manual-coverage-gap`, and has no outbox row; the receipt says "(manually entered)" and "no provider verification, no CLV" (browser tests 1-3).

## EVIDENCE:

Command: `pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts` (on b64849542)

```
ok 83 - WORK-2026110802: accepts canonical teams + manual player Herro (NBA threes, Celtics @ Bucks) as Track Only
ok 84 - WORK-2026110802: accepts canonical teams + manual player Burries (NBA rebounds, Celtics @ Bucks) as Track Only
ok 85 - WORK-2026110802: accepts canonical teams + manual player Dulcich (NFL receptions, Lions @ Dolphins, no player coverage at all) as Track Only
ok 86 - WORK-2026110802: refuses a manual player whose name resolves to a canonical player, naming the match
ok 87 - WORK-2026110802: a player search error is retryable and never recorded as a coverage gap
ok 88 - WORK-2026110802: a player search that times out is retryable and never recorded as a coverage gap
ok 89 - WORK-2026110802: refuses delivery-eligible with a manual player, with or without a server delivery authorization
ok 90 - WORK-2026110802: refuses a manual player beside a canonical player selection
ok 91 - WORK-2026110802: refuses a manual player beside a canonical event id
ok 92 - WORK-2026110802: refuses a manual player in a sport with no structured team fallback
ok 93 - WORK-2026110802: refuses a manual player that carries a canonical participant id
ok 94 - WORK-2026110802: refuses a flat canonical playerId beside a manual player
ok 95 - WORK-2026110802: requires manual-coverage-gap player provenance and refuses it without a manual player
ok 96 - WORK-2026110802: refuses a manual player carrying a provider offer
ok 97 - WORK-2026110802: refuses manualPlayer on the all-manual coverage-gap resolution
ok 98 - WORK-2026110802: the teams beside a manual player are verified exactly as for any structured fallback
# tests 98
# pass 98
# fail 0
# skipped 0
```

Command: `pnpm exec tsx --test test/form-utils.test.ts test/submission-guard.test.ts` (in `apps/smart-form`, on b64849542)

```
ok 43 - WORK-2026110802: manual player entry is offered only after a definitive not-found in the structured team fallback
ok 44 - WORK-2026110802: the client guard accepts a typed player only after a definitive not-found, never after an errored or unrun search
ok 45 - WORK-2026110802: without the manual choice, a typed player name is still refused in every search state
ok 46 - WORK-2026110802: the client guard keeps a manual player Track Only and out of every other identity shape
ok 47 - WORK-2026110802: the Herro payload carries canonical teams, a manual player, Track Only and manual provenance
ok 48 - WORK-2026110802: the Burries payload carries canonical teams, a manual player, Track Only and manual provenance
ok 49 - WORK-2026110802: the Dulcich payload carries canonical teams, a manual player, Track Only and manual provenance
ok 50 - WORK-2026110802: withManualPlayer drops any canonical player and event id
ok 51 - WORK-2026110802: a payload without a manual player carries no player provenance claim
# tests 58
# pass 58
# fail 0
# skipped 0
```

### Mutation proofs (each applied alone to the working copy, suite run, file restored and `cmp`-checked)

Baseline: the same two commands above, 98/98 and 58/58 pass.

1. Remove the server coverage verification: `if (resolution.manualPlayer) {` -> `if (false && resolution.manualPlayer) {` in `validateStructuredTeamFallback`. Command: `pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts`

```
not ok 83 - WORK-2026110802: accepts canonical teams + manual player Herro (NBA threes, Celtics @ Bucks) as Track Only
not ok 84 - WORK-2026110802: accepts canonical teams + manual player Burries (NBA rebounds, Celtics @ Bucks) as Track Only
not ok 85 - WORK-2026110802: accepts canonical teams + manual player Dulcich (NFL receptions, Lions @ Dolphins, no player coverage at all) as Track Only
not ok 86 - WORK-2026110802: refuses a manual player whose name resolves to a canonical player, naming the match
not ok 87 - WORK-2026110802: a player search error is retryable and never recorded as a coverage gap
not ok 88 - WORK-2026110802: a player search that times out is retryable and never recorded as a coverage gap
# pass 92
# fail 6
```

Test 86 is the named kill (a covered name is accepted). Tests 83-85 fail on their non-vacuity assertion "the server must search players before accepting a manual player".

2. Remove the manual-player delivery refusal: `if (distributionMode !== 'track-only') {` -> `if (false && distributionMode !== 'track-only') {` in `assertManualPlayerAdmissible`. Same command.

```
not ok 89 - WORK-2026110802: refuses delivery-eligible with a manual player, with or without a server delivery authorization
# pass 97
# fail 1
```

3. Restore client acceptance of an errored search: `canOfferManualPlayer` and the `evaluateSubmissionGuards` not-found check also accept `'error'`. Command: `pnpm exec tsx --test test/form-utils.test.ts test/submission-guard.test.ts` (in `apps/smart-form`)

```
not ok 43 - WORK-2026110802: manual player entry is offered only after a definitive not-found in the structured team fallback
not ok 44 - WORK-2026110802: the client guard accepts a typed player only after a definitive not-found, never after an errored or unrun search
# pass 56
# fail 2
```

### Browser run (operator-run; no CI workflow runs Playwright)

Command (in `apps/smart-form`): `CI=1 SMART_FORM_E2E_API_PORT=4610 SMART_FORM_E2E_PORT=4710 SMART_FORM_DIST_DIR=.next-e2e-0802 pnpm exec playwright test e2e/manual-player-fallback.spec.ts --reporter=list`

Real local API in in-memory persistence mode (the spec asserts `persistenceMode: in_memory`), real QA team/player search, persisted pick read back from the API. Only the Auth.js session and the reference availability probe are fulfilled by the spec; test 4 makes the player search return 503.

```
  ✓  1 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Herro (NBA threes) saves as a Track Only manual player beside canonical teams (6.1s)
  ✓  2 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Burries (NBA rebounds) saves as a Track Only manual player beside canonical teams (6.2s)
  ✓  3 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Dulcich (NFL receptions) saves as a Track Only manual player beside canonical teams (6.8s)
  ✓  4 e2e/manual-player-fallback.spec.ts:181:5 › WORK-2026110802: a failed player search never offers manual entry and the typed name is refused (5.4s)
  4 passed (34.9s)
```

Bounded difference from the operator's report: the local QA catalog is used, so the NBA shapes run Celtics @ Knicks, not Celtics @ Bucks. The player names are the operator's, and the spec first asserts each is absent from the local player search.

## PM changes (2026-11-11), measured on 4361dd6ef

Commands: `pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts`,
`pnpm exec tsx --test apps/api/src/clv-service.test.ts`,
`pnpm exec tsx --test test/form-utils.test.ts test/submission-guard.test.ts` (in `apps/smart-form`).

```
ok 95 - WORK-2026110802: refuses a client playerProvenance claim without a manual player
ok 99 - WORK-2026110802 F2: punctuation, alias-token and confusable spellings of a covered player are refused
ok 100 - WORK-2026110802 F2: the full-name query runs first, so the match is found before any one-word query
ok 101 - WORK-2026110802 F2: a true match past a common-token page is still found by the exact full-name query
ok 102 - WORK-2026110802 F2: a saturated decisive search fails closed instead of recording a gap
ok 103 - WORK-2026110802 F2: a saturated first-name search does not block a genuinely uncovered player
ok 104 - WORK-2026110802 F3: the server stamps provenance and manual labels, overwriting the client values
ok 105 - WORK-2026110802 F3: a refused manual player is never stamped
ok 106 - WORK-2026110802 F4: manualPlayer is a strict allow-list of fields
ok 107 - WORK-2026110802 F4: manualPlayer.displayName is length-, word- and character-bounded
ok 108 - WORK-2026110802 F4: the number of coverage searches is bounded for a worst-case admitted name
ok 109 - WORK-2026110802 F4: exhausting the total search budget is retryable and never records a gap
ok 110 - WORK-2026110802 F4: a malformed search response is retryable and never records a gap
# tests 110
# pass 110
# fail 0
# skipped 0
```

```
ok 39 - WORK-2026110802: control -- the same name-matched pick without manual provenance computes CLV
ok 40 - WORK-2026110802: a manual coverage-gap player gets no CLV through the name fallback (server-stamped playerProvenance)
ok 41 - WORK-2026110802: a manual coverage-gap player gets no CLV through the name fallback (participantResolution.manualPlayer only)
ok 42 - WORK-2026110802: a manual coverage-gap player gets no CLV through the name fallback (both markers)
ok 43 - WORK-2026110802: a manual coverage-gap player gets no CLV even with a caller pre-resolved context
ok 44 - WORK-2026110802: an unrelated playerProvenance value does not suppress CLV
# tests 44
# pass 44
# fail 0
# skipped 0
```

```
ok 52 - WORK-2026110802 F3: the client provenance constant is the contract constant
ok 53 - WORK-2026110802 F3: a manual player keeps other manual fields and adds player once
ok 54 - WORK-2026110802 F3: without a manual player no player label is added
# tests 61
# pass 61
# fail 0
# skipped 0
```

### PM-change mutation proofs (each applied alone, suite run, file restored and diff-checked)

- CLV exclusion block removed from `computeCLVOutcome`: `not ok 40, 41, 42, 43` (clv suite, 4 fail).
- Pre-fix query builder restored (whitespace words only) for the manual player: `not ok 99, 100, 101`.
- Saturation fail-closed disabled: `not ok 102`.
- Server stamp call removed: `not ok 104`.
- Field allow-list disabled: `not ok 106`.
- Length cap disabled: `not ok 107`.
- Both budget mechanisms disabled (deadline check and per-search `min(timeout, remaining)`): `not ok 109`. Either one alone still fails closed (each mutation alone: 0 fail), so they are redundant by design.
- Client: `player` label no longer added in `buildSubmissionPayload`: `not ok 47, 48, 49, 53`.

### Browser run on 4361dd6ef

Same command as below; the spec now also asserts the persisted `manualEntry: true` and `player` in
`manualOverrideFields` (server-stamped).

```
  ✓  1 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Herro (NBA threes) saves as a Track Only manual player beside canonical teams (7.7s)
  ✓  2 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Burries (NBA rebounds) saves as a Track Only manual player beside canonical teams (7.3s)
  ✓  3 e2e/manual-player-fallback.spec.ts:121:7 › WORK-2026110802: Dulcich (NFL receptions) saves as a Track Only manual player beside canonical teams (6.7s)
  ✓  4 e2e/manual-player-fallback.spec.ts:184:5 › WORK-2026110802: a failed player search never offers manual entry and the typed name is refused (5.1s)
  4 passed (52.8s)
```

### `pnpm verify` on 4361dd6ef

`verify:static`: green. Summed over its 122 TAP summaries: tests 8224, pass 8211, fail 0, skipped 13.
`test:live-db`: refused locally, as designed (`[assert-staging] REFUSED: target identity could not be
resolved from its URL (host=127.0.0.1)`), so `pnpm verify` exits 1 on this host for that reason only.
`pnpm lint` exit 0 and `pnpm type-check` exit 0 (run on 234e4983e before the main sync).

A runtime value import of `@unit-talk/contracts` into the Smart Form client was tried and broke
`next build` (`Module not found: Can't resolve './smart-form.js'` from `packages/contracts/src/index.ts`),
so the client constant is a literal typed as `typeof manualPlayerProvenance` plus a runtime equality test.

## Review round 2 (2026-11-11), code commit 8a90b9730, measured on its tree and f40e33cc5

Command: `pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts apps/api/src/clv-service.test.ts`

```
# pass 168
# fail 0
```

(smart-form-validation 123 tests, clv-service 45 tests.) `cd apps/smart-form && pnpm test`: `# pass 242`,
`# fail 0`. `pnpm lint` exit 0, `pnpm type-check` exit 0.

### Round-2 mutation proofs (each applied alone, focused suite run, file restored)

All 25 killed: no accent tolerance (5 fail); vowel/consonant split removed (4); contiguous-run match
(1); player matcher replaced by `isSameEntityName` (1); no suffix stripping (1); no initials rule (1);
no all-given-names rule (1); no concatenation probes (3); no market binding (1); no marketType binding
(1); no selection binding (1); no statType catalog check (1); no flat-player binding (1); P2-A refusal
disabled (1); P2-A only on the first return (1); no character allow-list (3); no NFC check (1); no
saturation fail-closed (2); no two-literal pattern threshold (1); no smart-apostrophe allowance (1);
CLV `resolveParticipantId` guard removed (clv 1); row limit 500 -> 100 (1); no joined-given rule (1);
no all-tokens-in-catalog rule (1); no reversed concatenation (1).

Reviewer probes (`probe.mts`, `probe2.mts`, run with `overUnder: 'over'` added so the selection binding
does not mask the coverage result): every catalog spelling is refused; the only acceptances are the two
label-overwrite cases, where the server stamps `manualEntry: true` and `player`.

### Browser run on 8a90b9730 tree

`CI=1 SMART_FORM_E2E_API_PORT=4610 SMART_FORM_E2E_PORT=4710 SMART_FORM_DIST_DIR=.next-e2e-0802 pnpm exec playwright test e2e/manual-player-fallback.spec.ts --reporter=list`
in `apps/smart-form`: `4 passed (44.5s)` (Herro, Burries, Dulcich saved; errored search refused).

### `pnpm verify` on f40e33cc5

`verify:static` green: summed over 122 TAP summaries, tests 8238, pass 8225, fail 0, skipped 13.
`test:live-db` refused locally as designed (`[assert-staging] REFUSED: target identity could not be
resolved from its URL (host=127.0.0.1)`), so `pnpm verify` exits 1 on this host for that reason only.

Unverified: the accent-tolerant `_` patterns are applied through PostgREST `.ilike()`
(packages/db `searchPlayers`); their behaviour and saturation rates against the real staging/production
catalog were not measured from this host (tests emulate ILIKE). Known limits: a token accented in both a
vowel and a consonant with under two literals left ("Nunez" for "Núñez"), and multi-letter
transliterations ("ss"/"ß"), are not matched.

## Review round 3 (2026-11-11), code commits df3d33296 + b7692eaca

Measured on the df3d33296 tree (working copy, then committed unchanged):

- `pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts apps/api/src/clv-service.test.ts`: `# tests 180`, `# pass 180`, `# fail 0` (validator 135, clv 45).
- `cd apps/smart-form && pnpm test`: `# tests 243`, `# pass 243`, `# fail 0`.
- `pnpm type-check` exit 0; `pnpm lint` exit 0.
- `CI=1 SMART_FORM_E2E_API_PORT=4610 SMART_FORM_E2E_PORT=4710 SMART_FORM_DIST_DIR=.next-e2e-0802 pnpm exec playwright test e2e/manual-player-fallback.spec.ts --reporter=list` in `apps/smart-form`: `4 passed (47.5s)`.

On b7692eaca (a test title change only): the focused command again `# tests 180`, `# pass 180`, `# fail 0`;
`pnpm exec eslint apps/api/src/smart-form-validation.test.ts` exit 0. `pnpm verify` was not re-run this round.

### Round-3 mutation proofs (each applied alone, focused suite run, file restored)

All 24 killed: no given-name prefix rule; no given-name one-edit rule; no given-name prefix-edit rule; no
two-letter full-initials rule; no single-initial rule (3 fail); multi-initials matched on the first only
(P2-4); no surname one-edit rule (2); no surname prefix rule; no surname initial rule (2); no matcher
transliteration; consonant wildcards back to c n s z (2, after adding Dogus/Ondrej); no transliteration
patterns; no reversed full-name query; only `player` bound (2); `providerParticipantId` allowed; id fields
refused only when truthy strings; raw name persisted; no space collapse; flat name fields not rewritten;
market prefix-only; market any key of the sport; malformed row skipped; near miss worded "resolves to" (4);
saturation ignored (3). Parity test: changing a key in the contract copy (1 fail), in the client table
(2), or adding a client-only stat (1) is caught.

Reviewer probes: `bypass.mts` now accepts only the nickname/initialism cases left to the PM ("JT", SGA, MPJ,
KAT, "Greek Freak", "King James", "Bron James", "Mike Porter Jr", "Wardell Curry") and the documented
accent limits ("Sengun", "Ibanez", "Nunez", "Jiri": accented in a vowel and a consonant, under two
literals left). `misc.mts`: trimmed name persisted, bad markets and flat fields refused, malformed row 503.
`usability.mts` (synthetic 12000-player catalog with emulated ILIKE; emulation only): of 131 absent names,
72 accepted, 25 refused as covered, 29 unverifiable (saturated, e.g. "_am" for "Cam Spencer", "ja_e_" for
"Jalen Pickett"), 5 refused as near misses of a different synthetic player (Josh/John Brown, Jose/Joe
Altuve, Yandy/Randy Diaz, Mike/Mikhail Jones, "T.J. Watt"/"J.T. Witt").

Unverified: runtime proof is still the CI staging receipt from PR head 900f46831; it does not exercise
the manual-player path. Real-catalog behaviour of the patterns, near-miss refusal rate and saturation
rate were not measured from this host.

## PM fallback: operator-confirmed unverified player (2026-11-11), uncommitted tree on a843bbad2

Implements the PM decision: a manual player similar to catalog players gets a 409
`SMART_FORM_MANUAL_PLAYER_CONFIRMATION_REQUIRED` with up to 5 candidates; the operator picks one or
confirms none, and the server accepts only an exact match of its recomputed set, stamping
`metadata.manualPlayerReview`. Error `details` flow through `ApiError` -> `errorResponse` (body
unchanged when there are no details) -> `SubmitPickError` in the client.

Results for this round are listed in the PR handback and will be re-measured on the exact head at the
final proof refresh; this section records the mutation proofs, which are not re-run there.

### PM-fallback mutation proofs (each applied alone, focused suite run, file restored)

All 24 killed. Confirmation set: subset accepted (8 fail), superset accepted (2), any confirmation
accepted (2), order-sensitive comparison (1), no 409 at all (suite fails to load). Client value overwrite:
client `manualPlayerReview` kept (2), client `confirmedNotCandidates` persisted as sent (2),
`operatorConfirmed` always true (1). Ranking: no cap (2), no name tie-break (1), no id tie-break (1), no
score order (5), surname not weighted (1). Input: review allowed without a manual player (1), review allowed
off Smart Form (1), duplicate ids allowed (1), key not allow-listed (9), teamName not resolved (1). Wire:
handler drops details (1), `errorResponse` always adds a details key (1). Client: any error code yields
candidates (1), malformed candidate skipped rather than refused (1), confirmation dropped from the payload
(1), error code dropped (1). The name tie-break and surname-weight mutants first survived; the ordering
fixture was changed so that id order and name order disagree, and so that an unweighted match sorts first,
after which both were killed.

## Verification (original, on b64849542)

Command: `pnpm verify` (lane worktree, on the tree later committed as b64849542 except the two
test-harness edits to the e2e spec and the docs edits listed in diff-summary.md)

- `verify:static` (env:check, lint, type-check, build, test and the remaining static suites): green.
  Summed over its 122 TAP summaries: tests 8200, pass 8187, fail 0, skipped 13.
- `test:live-db` (`pnpm test:db && pnpm test:t1-proof:live`): refused locally, as designed:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

After the e2e spec edits: `pnpm exec eslint apps/smart-form/e2e/manual-player-fallback.spec.ts` exit 0;
`pnpm exec tsc --noEmit` in `apps/smart-form` exit 0.

## Runtime Verification

This host holds no staging credential and its `SUPABASE_URL` is the containment placeholder
(preflight PT1: BLOCKED_BY_CONTAINMENT), so `pnpm test:db` against staging xskgrzbteyqdufktjrjx runs
only in CI's "Writable DB proof (staging only)" job on the exact PR head; that job's
`ci-db-proof-receipt/v2` is the authoritative record and is harvested into `evidence.json` by
`ops:proof-generate`. No production data was read or written by this lane. This lane adds no
migration and no new write path; the persisted shape was asserted against the real local API above.

Execution SHA: b7692eacac44b95cabf6138e71f2c7a4dc502641 (review round 3; round 2 f40e33cc5; PM changes 4361dd6ef; original b64849542b6964eb7f23fb97ed6c64b06effa317)

The staging result below is from the earlier head 900f46831; CI's staging job re-runs on the new PR
head and its receipt is authoritative. It was not re-harvested here.

## CI staging result (PR head 900f46831d2c47d35daa266743f0eaded6f0afb3): SUPERSEDED

**Superseded.** This receipt is from 900f46831, before the round-3 and PM-fallback code. It is not
exact-head evidence for any later head and must not be cited as such; the final proof refresh harvests
the receipt for the exact PR head.


CI run 42968390678, job "Writable DB proof (staging only)" 130351015911: success, against staging
xskgrzbteyqdufktjrjx. `pnpm test:db`: 9 tests, 9 pass, 0 fail (from the run's `ci-db-proof-receipt/v2`).
`evidence.json` `runtime_proof` was harvested from that receipt and job log with the exported steps of
`scripts/ops/ci-db-proof-harvest.ts` (see its `harvest_method`): receipt hash integrity, run identity and
merge-ref ancestry (merge ref f719cb12ca0279d647fa365e5e1b0d75b88c09c0, second parent the PR head) verified.
`database-smoke.test.ts` is the repository's standing staging smoke; it does not exercise the manual-player
path, which adds no table, column or write path. The follow-on commit adding this is proof-only; its own
exact-head CI re-runs the same staging job.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: b7692eacac44b95cabf6138e71f2c7a4dc502641
