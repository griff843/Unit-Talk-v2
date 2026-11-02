# PROOF: WORK-2026110205

MERGE_SHA: pending merge

Tier: T1. State: implementation candidate, incomplete acceptance evidence.
Rework implementation source: `d7d268369` (full SHA in evidence.json). Historical regression-first evidence remains from the original implementation.

## Verification

### ASSERTIONS

- PASS: No first-hit, substring or token-subset match binds artwork. All four resolvers require exactly one normalized full-name identity, with available team and league checks. Case, diacritics, punctuation, whitespace, Junior/Jr and Senior/Sr normalize symmetrically; missing/different suffixes, including II/III, remain distinct.
- PASS: NHL unrelated player, NHL ambiguous name and NFL unrelated first result were tested before service edits. Six existing API tests passed and all three regressions failed. The baseline service blob was identical to origin/main at `fddc405696098800209f634e471607b2400eec43`. No prepared regression tests were found in existing Codex worktrees or session scratchpads; the three tests were written in the assigned test file and retained verbatim.
- PASS: Restoring NHL data[0] or NFL first-hit selection fails the tests. Both mutations were killed again at d7d268369 in isolated copies of the exact committed service and test; working-tree source was never mutated.
- PASS: Refusal reasons appear in run details, and an existing stored image is never rewritten.
- PASS: Unverified legacy player artwork stays on the approved Smart Form emblem. The current media response carries no evidence that the pictured person was verified, so no player photo is displayed. The endpoint/approved host list is unchanged. Form submission code is unchanged.
- PASS: Isolated production React components were exercised in Chromium with mocked media responses. Unverified URL, mismatched selection response and load failure all produce an accessible emblem and no broken img. This is component browser evidence, not a deployed form or end-to-end submission proof.
- PASS: authorized rework repairs canonical/provider team namespaces and resolves NBA columns by header. Three rework regressions failed before repair (14 pass / 3 fail), then focused tests passed 24/24. Revalidation rerun results are below. No production connection was made.
- RESOLVED FORMAT DEVIATION: the packet requests v1, but the pre-merge validator rejects v1. Production Claude’s explicit §16 reshape in `.out/media-0205/REWORK-DIRECTIONS.md` authorizes schema_version 2. This bundle now uses v2, app-runtime profile, null merge SHA, CI-resolved binding sentinels and no author-written verifier identity. No guard was changed.
- DEFERRED: writable DB proof, exact-head CI, independent Claude review, Griff's exact-head T1 verdict, governed merge, and merge-SHA binding.

### EVIDENCE

| Check | Measured evidence |
|---|---|
| Regression-first | `regression-before.txt`: 9 tests, 6 pass, 3 fail; failures return unrelated NHL 8484554, ambiguous NHL id 1, unrelated ESPN URL. |
| Focused final source | `pnpm exec tsx --test apps/api/src/player-enrichment-service.test.ts apps/smart-form/test/participant-media.test.ts`; `rework-focused-after.txt`: 24 tests, 24 pass, 0 fail. Existing tests retained; API 6 → 17, media 6 → 7. |
| Real ESPN payload regression | `espn-relationships-before.txt`: 13 pass, 1 fail before the relationship parser repair; final focused 24/24 includes teamRelationships and leagueRelationships checks. |
| Mutations | `mutations.json`, `mutation-nhl-data0.txt`, `mutation-nfl-first-hit.txt`: both exit 1, killed. |
| Live provider probes | `live-provider-probes.json` and `provider-raw/1.txt` through `4.txt`: real existing MLB/NBA/NFL/NHL endpoints, all HTTP 200. MLB Aaron Judge and NBA LeBron James confirmed; NFL Josh Allen ambiguous; NHL Jake Evans identity-mismatch. These are probes, not stored-image revalidation. |
| Rendered fallback | `browser-proof.json`, `emblem-browser.png`; replay script in lane `.out/media-0205/browser-proof.cjs`. |
| General QA | `qa-experience.json`: SKIP because localhost:4100 /submit and auth/session were unavailable. No general UI QA success is claimed. |
| DB guard | `test-db.txt`: refused localhost, ref unidentified; staging credentials are required. No DB suite or write executed. |
| Type check | `pnpm type-check`: exit 0. |
| Full verification | See rework-gate-results.txt and the ready-for-pr handoff for the final observed command results and head binding. No green `pnpm verify` or staging CI claim is made here. |
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

`stored-headshots-revalidated.json` records each participant, stored URL, new-matcher URL, verdict and reason. The rerun at implementation commit `d7d268369` made 320 real provider requests, all HTTP 200; bodies remain in `stored-provider-raw/`.

| Sport | Rows | Confirmed stored URL | Mismatch | Ambiguous | Unresolved | Unique different URL |
|---|---:|---:|---:|---:|---:|---:|
| MLB | 951 | 869 | 80 | 2 | 0 | 7 |
| NBA | 228 | 145 | 83 | 0 | 0 | 2 |
| NHL | 318 | 246 | 66 | 6 | 0 | 46 |
| Total | 1497 | 1260 | 229 | 8 | 0 | 55 |

`stored-headshots-url-differences.json` explicitly lists all 55 participant IDs, names, sports, stored URLs and uniquely resolved different URLs. Of these, 47 have an existing non-null stored URL (MLB 1, NHL 46); eight have no stored URL (MLB 6, NBA 2) and are not wrong-photo cases. This is a read-only review input; it authorizes no stored URL changes. The remaining 174 mismatches are refusals, not proof of a wrong-person photo. All six NHL Jakes sharing stored ID 8484554 have null new-matcher URLs and remain on the emblem.

MLB/NHL payloads sometimes provide only numeric team IDs without comparable full team names. A canonical key is never equated with such a numeric ID. Missing comparable team data contributes no match evidence: exactly one normalized full player name is still required, and all comparable available team names, abbreviations and league fields must agree. This is provider identity correlation, not visual recognition of the image. No new provider/endpoint, DB import, production connection or stored-metadata update was added.

NFL has no stored rows. The separate live four-sport probes were rerun at the repaired implementation commit and raw responses retained in `provider-raw/`.

### Rework before/after cases

| Case | Before repair | After repair |
|---|---|---|
| Canonical CHICAGO_WHITE_SOX_MLB vs Chicago White Sox / numeric 145 | identity-mismatch | confirmed |
| BOSTON_RED_SOX_MLB vs Chicago White Sox | identity-mismatch | identity-mismatch |
| LOS_ANGELES_CLIPPERS_NBA vs LA Clippers / LAC | identity-mismatch | confirmed |
| Lakers canonical key vs LA Clippers | identity-mismatch | identity-mismatch |
| Reordered NBA column headers | fixed positions cannot correlate | same correct player/team |
| Six NHL Jakes sharing stored 8484554 | all refused due namespace defect | live results still unconfirmed; none displays stored photo |

Rework test output: `rework-regression-before.txt` (17 tests, 14 pass / 3 fail); `rework-focused-after.txt` (24/24 pass). The three original motivating tests remain verbatim. The existing `updateMetadata` write is unchanged. `package.json` is a singleton held by WORK-2026103022 and out of scope. No new live DB test was added and no live DB enrichment proof is claimed.

Writable live-DB proof remains blocked/deferred: local staging identity guard refuses localhost (127.0.0.1, unidentified project) before suites. The authorized path requires xskgrzbteyqdufktjrjx through the staging-ci GitHub environment and CI_SUPABASE_* credentials. No guard bypass, production write, PR opening or push is authorized in this rework.

Exact-head CI, independent Claude review, Griff’s t1-approved label and pm-verdict/v1 APPROVED, governed merge and actual merge-SHA binding remain pending. The repaired source passed all static gates in `pnpm verify`; the command then exited 1 at the staging identity guard before live suites. Smart Form e2e was not enabled. See `rework-gate-results.txt` and the local ready-for-pr handoff for head binding; no exact-final-head full green verification is claimed.
