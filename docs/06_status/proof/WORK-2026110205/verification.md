# PROOF: WORK-2026110205

MERGE_SHA: pending merge

Tier: T1. Implementation source: `36483d1b993082c13e7dd16e9647d757950618c2`. Independent-review repair complete locally; staging acceptance remains pending.

## Verification

### ASSERTIONS:

- [x] All four resolvers require exactly one normalized full-name candidate. No positional, substring or token-subset player selection remains. Case, diacritics, punctuation and whitespace normalize; Jr/Junior and Sr/Senior normalize symmetrically, while absent/different suffixes and II/III remain distinct.
- [x] Available team and league identities must agree. A production catalog team key is translated to a full name; provider numeric IDs compare only with numeric IDs. When both sides carry teams but cannot be correlated, the matcher refuses the candidate. NHL abbreviations use a verified 32-team dictionary; MLB IDs use a verified 30-team dictionary. NBA columns are read by header; ESPN relationship identities are checked.
- [x] NHL/NFL searches now request 100 results instead of five, including namesakes outside the old window. A response filling the 100-result window returns ambiguous because uniqueness is unproven. Zero credible matches returns identity-mismatch, multiple credible matches returns ambiguous, and provider failure returns unresolved. Refusals are counted in run details.
- [x] Legacy player media carries no identity-verification evidence, so Smart Form keeps it on the approved emblem. The emblem duplicates BrandLogo geometry within Smart Form and carries the participant's accessible name. Image errors also show the emblem. Approved hosts and participant-envelope checks remain intact. Artwork never affects form validity.
- [x] The existing `updateMetadata` write and existing-headshot skip are unchanged. No existing stored URL is rewritten. `package.json` is a singleton held by WORK-2026103022 and out of scope. No new live DB test was added; no live DB enrichment proof is claimed.
- [x] No submission, distribution, outbox, worker, schema, domain or contract path changed. No production connection, production write, deploy or provider activation occurred.
- [x] The packet requests bundle v1; Production Claude explicitly authorized schema_version 2 in `.out/media-0205/REWORK-DIRECTIONS.md` because the pre-merge validator rejects v1. Merge SHA remains null, CI-resolved sentinels remain, and no verifier identity is authored here.

### EVIDENCE:

Focused suites re-run by Production Claude at c0a35a0bf (source identical to 36483d1b9):

```text
$ pnpm exec tsx --test apps/api/src/player-enrichment-service.test.ts apps/smart-form/test/participant-media.test.ts
# tests 35
# suites 0
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

| Check | Observed result |
|---|---|
| Original regression-first | `regression-before.txt`: 6 pass / 3 fail against the unmodified main service blob `fddc405696098800209f634e471607b2400eec43`. NHL unrelated, NHL ambiguous and NFL unrelated-first cases remain verbatim in the assigned test. Original executor found no prepared Codex tests. |
| Prior rework regressions | `rework-regression-before.txt`: 14 pass / 3 fail before NBA-header/team-namespace repair; original evidence retained. |
| Independent-review regressions first | `review-regressions-before.txt`: 19 pass / 5 fail on reviewed head `7eb3d980a`. Seven tests added: five expose unsafe acceptance/search-window failures; matching NHL and MLB controls already pass. |
| Focused final source | `pnpm exec tsx --test apps/api/src/player-enrichment-service.test.ts apps/smart-form/test/participant-media.test.ts`: **35 pass / 0 fail**, `narrow-regressions-after.txt`. No test removed. |
| Narrow review regressions first | `narrow-regressions-before.txt`: 33 pass / 2 fail on `213644a73`; unknown-team controls pass, NHL/NFL saturated-window regressions fail. |
| Mutation | `mutations.json` and `mutation-*.txt`: restoring NHL data[0] or NFL first-hit selection exits 1; both and the unknown-provider-team fall-through mutation killed using isolated copies of exact committed source/test at `36483d1b9`. |
| Type check | PASS within `pnpm verify` at `36483d1b9`; `.out/media-0205/verify-narrow.txt`. |
| Full verification | `pnpm verify` at `36483d1b9`: every `verify:static` gate passed, then exit 1 at staging identity guard before DB suites. Full log `.out/media-0205/verify-narrow.txt`; summary `narrow-gate-results.txt`. Smart Form e2e not enabled. No full-green or staging acceptance claim. |
| R-level | PASS at `36483d1b9`, operator-ui; `.out/media-0205/r-level-narrow.txt`. The checker selects a pre-existing command-center QA artifact. This does not establish full Smart Form QA. |
| Dictionaries | `team-dictionaries-validation.json`: all 30 MLB ID/name pairs and 32 NHL abbreviation/name pairs agree with provider data; raw responses saved. |
| Live four-sport probes | `live-provider-probes.json`, raw `provider-raw/1.txt` through `4.txt`: all HTTP 200. MLB Aaron Judge and NBA LeBron James confirmed; NFL Josh Allen ambiguous; NHL Jake Evans ambiguous because the live search fills the 100-result window. |
| Submission regression | `pnpm exec tsx --test apps/api/src/submission-service.test.ts`: 98 pass / 0 fail; `.out/media-0205/submission-service-review.txt`. |
| Component browser proof | Retained `browser-proof.json` and `emblem-browser.png`: isolated real components exercised in Chromium with mocked media, including unverified URL, mismatched envelope and image failure. This is component proof, not a deployed-form or submission e2e proof. |
| General QA | `qa-experience.json`: SKIP because local submit service/auth unavailable. No general UI QA success claimed. |
| Writable DB | `narrow-test-db.txt`: target identity guard refused 127.0.0.1 / unidentified before suites. No DB suite or write ran. |
| Observed routing | `model-routing.json`: current session turn_context directly records gpt-6.1-sol / medium, session `01a19dc8-2535-73c0-b528-4451a0e3db50`. Wrapper owns final execution metrics. |

### Before/after refusal and ambiguity cases

| Case | Before | After |
|---|---|---|
| NHL unrelated first candidate | Another player's headshot | null, identity-mismatch |
| NHL duplicate credible full name | First candidate | null, ambiguous |
| NFL unrelated first candidate | First result | null, identity-mismatch |
| NFL duplicate full name | First exact hit | null, ambiguous |
| MLB/NBA shared or partial name | First substring/token match | null unless exactly one normalized full name matches |
| Gary Trent versus Gary Trent Jr. | Substring resolvers could bind a relative | null, identity-mismatch |
| MONTREAL_CANADIENS_NHL versus PIT, numeric 5, no provider full name | confirmed on reviewed head | null, identity-mismatch |
| MONTREAL_CANADIENS_NHL versus MTL, numeric 8 | confirmed without comparable team evidence | confirmed after explicit abbreviation/name translation |
| BOSTON_RED_SOX_MLB versus numeric 145 | confirmed on reviewed head | null, identity-mismatch |
| CHICAGO_WHITE_SOX_MLB versus numeric 145 | confirmed without comparable team evidence | confirmed after explicit ID/name translation |
| Caller team BOS versus provider MTL/8 | confirmed on reviewed head | null, identity-mismatch |
| Same-name candidate ranked sixth, NHL and NFL | one visible match, confirmed | both visible, ambiguous |
| Unknown MLB team 431 / NHL XYZ with catalog caller | Current source already refuses; old fall-through mutation survives previous tests | null, identity-mismatch; mutation killed |
| Full NHL/NFL search window with one visible identity match | confirmed with uniqueness unproven | null, ambiguous |

### Revalidation of stored headshots

Input: Production Claude's `.out/media-0205/stored-headshots-snapshot.json`, with SQL/provenance in `.out/media-0205/snapshot-query.sql`. **1497 unique rows**: MLB 951, NBA 228, NHL 318; 1488 non-null stored URLs and nine null URLs. All supplied rows are included. Sorted full-ID MD5 `55ed0cd422c311e89672da80b5868d4e` matches the supplied integrity record; input SHA-256 is in the output. The executor never queried production.

`stored-headshots-revalidated.json` records participant ID, sport, stored URL, matcher URL/null, verdict and reason for every row. All **320 real provider requests returned HTTP 200** at implementation head `36483d1b9`; bodies are saved in `stored-provider-raw/`. MLB/NBA use the actual matcher cache; NHL makes one request per row. NFL has no stored rows and is covered by the separate live probe.

| Sport | Rows | Confirmed stored URL | Mismatch | Ambiguous | Unresolved | Unique different URL |
|---|---:|---:|---:|---:|---:|---:|
| MLB | 951 | 766 | 185 | 0 | 0 | 5 |
| NBA | 228 | 145 | 83 | 0 | 0 | 2 |
| NHL | 318 | 141 | 96 | 81 | 0 | 46 |
| Total | 1497 | 1052 | 364 | 81 | 0 | 53 |

`stored-headshots-url-differences.json` lists all 53 unique resolutions to different URLs: 47 have a non-null stored URL; 6 have null stored URLs. A refusal does not prove that a stored photo depicts the wrong person. Current-team conflicts, unknown teams and missing comparable team evidence now refuse safely. Wider searches also reveal additional credible candidates. All six NHL Jakes sharing stored ID 8484554 remain unconfirmed against their stored URLs; unresolved imagery remains on the emblem.

This is provider identity correlation, not visual recognition of image contents. The report is a read-only review input. Any production rewrite requires Griff's separate approval against this file; this lane performs none.

The narrow-review rerun found 77 NHL responses filling the 100-result window; all now refuse as ambiguous. Counts changed from 1103/388/6 to 1052/364/81 (confirmed/mismatch/ambiguous). No provider failures occurred.

### Team dictionary choice and provenance

An in-file MLB dictionary avoids adding a request, cache or new runtime provider dependency. Its 30 IDs/full names were fetched from `https://statsapi.mlb.com/api/v1/teams?sportId=1`; `mlb-teams-raw.json` saves the response. NHL's 32 abbreviations were checked against the saved search payloads, and names checked against `https://api.nhle.com/stats/rest/en/team`; `nhl-teams-raw.json.gz` saves that response (UTA id 68, Utah Mammoth). These evidence-only provider calls do not change runtime endpoints or populate reference data. Unknown teams fail closed.

### Deferred acceptance and publication

Writable live-DB proof is blocked/deferred: the observed local target is host=127.0.0.1 / unidentified. Writable verification requires staging project `xskgrzbteyqdufktjrjx`, through the staging-ci GitHub environment and `CI_SUPABASE_*` credentials. No guard bypass or local write is attempted. The packet's original host=unparseable diagnosis is superseded by the observed local guard output.

PR #1822 already exists. The rework direction requires local commits and wrapper-owned publication after Production Claude coordinates the staging slot; no push, PR creation or executor-result/v1 READY_FOR_REVIEW publication is performed here. Exact-head CI Writable DB proof/T1 suites, full UI QA, independent Claude re-review, Griff's `t1-approved` label and exact-head `pm-verdict/v1` APPROVED, governed merge and merge-SHA binding remain pending. No completion or acceptance claim is made with a red gate.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1822
