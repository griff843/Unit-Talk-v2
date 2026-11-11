# PROOF: WORK-2026110802

MERGE_SHA: pending merge

> `post-merge-lane-close.yml` binds the merge SHA; it is never written here by hand.

Issue: WORK-2026110802
Tier: T1
result: pass (static and browser evidence below; staging DB proof runs in CI only, see Runtime Verification)

## Summary

Adds the participant-resolution rung "canonical teams + one manually entered player" (structured
team fallback, `eventId: null`, team sports) as a server-verified, Track Only only path. Code head
under test: b64849542b6964eb7f23fb97ed6c64b06effa317.

## ASSERTIONS:

- [x] Herro, Burries (NBA) and Dulcich (NFL) shapes are accepted as Track Only with canonical teams and a manual player (api tests 83-85; browser tests 1-3).
- [x] A manual player whose name resolves to a canonical player is refused, naming the match (api test 86).
- [x] A player search error or timeout is a retryable 503 `SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE` and never a recorded gap (api tests 87, 88).
- [x] `delivery-eligible` with `manualPlayer` is refused (`SMART_FORM_MANUAL_PLAYER_TRACK_ONLY_REQUIRED`) with or without a server delivery authorization (api test 89).
- [x] `manualPlayer` with `player`, with an event id, in a non-team sport, with a non-null canonical id, with a flat `playerId`, with a provider offer, without `manual-coverage-gap` provenance, or on the all-manual resolution is refused (api tests 90-97).
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

## Verification

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

Execution SHA: b64849542b6964eb7f23fb97ed6c64b06effa317

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: b64849542b6964eb7f23fb97ed6c64b06effa317
