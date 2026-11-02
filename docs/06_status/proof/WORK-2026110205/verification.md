# PROOF: WORK-2026110205

MERGE_SHA: pending merge

Tier: T1. State: implementation candidate, incomplete acceptance evidence.
Implementation source: `d3464409b` (full SHA in evidence.json).

## Verification

### ASSERTIONS

- PASS: No first-hit, substring or token-subset match binds artwork. All four resolvers require exactly one normalized full-name identity, with available team and league checks. Case, diacritics, punctuation, whitespace, Junior/Jr and Senior/Sr normalize symmetrically; missing/different suffixes, including II/III, remain distinct.
- PASS: NHL unrelated player, NHL ambiguous name and NFL unrelated first result were tested before service edits. Six existing API tests passed and all three regressions failed. The baseline service blob was identical to origin/main at `fddc405696098800209f634e471607b2400eec43`. No prepared regression tests were found in existing Codex worktrees or session scratchpads; the three tests were written in the assigned test file and retained verbatim.
- PASS: Restoring NHL data[0] or NFL first-hit selection fails the tests. Both mutations were restored; final source is clean.
- PASS: Refusal reasons appear in run details, and an existing stored image is never rewritten.
- PASS: Unverified legacy player artwork stays on the approved Smart Form emblem. The current media response carries no evidence that the pictured person was verified, so no player photo is displayed. The endpoint/approved host list is unchanged. Form submission code is unchanged.
- PASS: Isolated production React components were exercised in Chromium with mocked media responses. Unverified URL, mismatched selection response and load failure all produce an accessible emblem and no broken img. This is component browser evidence, not a deployed form or end-to-end submission proof.
- MEASURED, WITH DEFECTS: revalidation of all 1497 supplied rows completed, with 320 real provider HTTP 200 responses. Nine confirmed, 1488 refused as identity-mismatch. Newly observed team-namespace and NBA-column defects prevent acceptance; these refusals do not prove 1488 wrong-person photos. No production connection was made.
- BLOCKED: the packet requests evidence bundle v1, while `validateEvidenceBundleContract` rejects schema_version=1 at the pre-merge authoring gate (`legacy_v1_not_allowed_pre_merge`). `evidence-contract-validation.json` records the measured failure. The requested v1 bundle is retained; the outer authority must reconcile this format conflict without weakening the guard.
- DEFERRED: writable DB proof, exact-head CI, independent Claude review, Griff's exact-head T1 verdict, governed merge, and merge-SHA binding.

### EVIDENCE

| Check | Measured evidence |
|---|---|
| Regression-first | `regression-before.txt`: 9 tests, 6 pass, 3 fail; failures return unrelated NHL 8484554, ambiguous NHL id 1, unrelated ESPN URL. |
| Focused final source | `pnpm exec tsx --test apps/api/src/player-enrichment-service.test.ts apps/smart-form/test/participant-media.test.ts`; `focused-after.txt`: 21 tests, 21 pass, 0 fail. Existing tests retained; API 6 → 14, media 6 → 7. |
| Real ESPN payload regression | `espn-relationships-before.txt`: 13 pass, 1 fail before the relationship parser repair; final focused 21/21 includes teamRelationships and leagueRelationships checks. |
| Mutations | `mutations.json`, `mutation-nhl-data0.txt`, `mutation-nfl-first-hit.txt`: both exit 1, killed. |
| Live provider probes | `live-provider-probes.json` and `provider-raw/1.txt` through `4.txt`: real existing MLB/NBA/NFL/NHL endpoints, all HTTP 200. MLB Aaron Judge and NBA LeBron James confirmed; NFL Josh Allen ambiguous; NHL Jake Evans identity-mismatch. These are probes, not stored-image revalidation. |
| Rendered fallback | `browser-proof.json`, `emblem-browser.png`; replay script in lane `.out/media-0205/browser-proof.cjs`. |
| General QA | `qa-experience.json`: SKIP because localhost:4100 /submit and auth/session were unavailable. No general UI QA success is claimed. |
| DB guard | `test-db.txt`: refused localhost, ref unidentified; staging credentials are required. No DB suite or write executed. |
| Type check | `pnpm type-check`: exit 0. |
| Full verification | See gate-results.txt and the ready-for-pr handoff for the final observed command results and head binding. No green `pnpm verify` or staging CI claim is made here. |
| R-level | `r-level.txt` / `r-level.json` record the committed diff check. UI rule requires qa-experience. The repository checker selected a command-center QA artifact from this run rather than validating the Smart Form surface or its verdict; that mechanical result does not establish current UI QA success. Current component browser evidence is recorded separately above. |
| Model | `model-routing.json`: actual session turn_context observed gpt-6.1-sol / medium. |

### Before/after refusal cases

| Case | Old result | New result |
|---|---|---|
| NHL Jake Evans, unrelated first candidate | 8484554 / Jake Johnson photo | null, identity-mismatch (also observed live) |
| NHL two Jake Evans identities | first id 1 photo | null, ambiguous |
| NFL no Josh Allen candidate | unrelated first photo | null, identity-mismatch |
| NFL two exact Josh Allen identities | first exact photo | null, ambiguous (also observed live) |
| MLB/NBA two normalized John Smith identities | first matching photo | null, ambiguous |
| Any sport Gary Trent vs Gary Trent Jr. | token/substring resolvers could bind a relative | null, identity-mismatch |

### Revalidation of stored headshots

Production Claude delivered `.out/media-0205/stored-headshots-snapshot.json` after the first attempt. Independently counted: **1497 unique participant rows**, MLB 951, NBA 228, NHL 318; 1488 non-null URLs and nine null URLs. Sorted full-ID MD5 `55ed0cd422c311e89672da80b5868d4e` matches the supplied integrity record. SQL and source provenance remain in the supplied `.out/media-0205/snapshot-query.sql`.

`stored-headshots-revalidated.json` records every supplied participant, stored URL, new-matcher URL, verdict and reason. All 320 real provider requests returned HTTP 200; bodies are saved in `stored-provider-raw/`. MLB/NBA rosters were cached by the actual matcher; NHL used 318 individual searches. NFL has no stored rows and is covered by the separate live four-sport probes.

Measured results: **9 confirmed, 1488 mismatch, 0 ambiguous, 0 unresolved**. All nine null stored URLs were refused. The six Jake participants sharing stored NHL URL 8484554 were all refused.

**New runtime defects — acceptance blocked:** supplied `team_external_id` values are canonical strings (for example `NEW_YORK_YANKEES_MLB`), whereas live provider team IDs are numeric. The matcher compares these different namespaces directly. Also the real NBA response headers place `TEAM_ID` at index 8 and `TEAM_ABBREVIATION` at 11, while the parser reads 7 and 10. These findings explain conservative refusals and mean the 1488 mismatch verdicts cannot be treated as 1488 wrong-person photos. Raw responses 1.txt, 2.txt and 3.txt expose the identity shapes/headers. Under the scoped stop rule for newly discovered runtime bugs, no further runtime edits were made. The outer executor must reconcile the repair before acceptance and rerun this report afterward.

This is **revalidation of stored headshots**. No production connection, metadata rewrite or DB write occurred. All player artwork remains on the branded fallback. Any later production rewrite requires Griff's separate approval against this file.

### DB and scope limits

The enrichment pass's existing `updateMetadata` write is unchanged. `package.json` is a singleton held by WORK-2026103022 and is out of scope. No new live DB test is added and no live DB enrichment proof is claimed.

Writable live-DB proof is blocked/deferred: the local guard could not resolve a staging target from its URL (observed host=127.0.0.1, ref=unidentified; the packet anticipated host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials, including the T1 live suites at the exact PR head. Never write to production.

## Merge SHA Binding

Merge SHA: pending merge. PR: pending. No draft PR was opened because the packet explicitly reserves PR opening for Production Claude's staging-slot sequence. No executor-result/v1 attestation was published by this child executor. Griff's t1-approved label and pm-verdict/v1 APPROVED comment at the exact head, independent review and governed merge remain pending.
