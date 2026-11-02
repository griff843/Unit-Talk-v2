# Diff summary: WORK-2026110205

| File | Result |
|---|---|
| apps/api/src/player-enrichment-service.ts | Unique normalized full-name matching for all four sports; team/league agreement; refusal counts. Independent-review repair translates 32 NHL abbreviations and 30 MLB numeric team IDs to full names, refuses incomparable teams, and widens NHL/NFL search from 5 to 100. NBA columns use headers; ESPN relationship identities are checked. |
| apps/api/src/player-enrichment-service.test.ts | Original three motivating regressions retained verbatim; normalization, suffix, ambiguity, team/league and stored-image preservation tests. Seven independent-review production-shape tests added; five fail on reviewed head 7eb3d980a. |
| apps/smart-form/lib/participant-media.ts | Legacy player photos remain on the emblem because the read response carries no image identity-verification evidence. Approved-host and participant-envelope checks stay intact. |
| apps/smart-form/app/submit/components/ParticipantArtwork.tsx | Approved BrandLogo emblem geometry replaces initials and broken images, with accessible participant name. |
| apps/smart-form/test/participant-media.test.ts | Approved-host legacy player photos cannot bypass fallback. |
| docs/06_status/proof/WORK-2026110205/* | Refreshed measured regressions, mutation evidence, raw provider data, dictionary verification, stored-headshot revalidation and pending acceptance gates. |

Implementation head: `88ed0431fa3c9ada782351115a54bd569cd30657`. All 31 focused tests pass; both old positional-selection mutations fail. Team dictionaries use existing provider identity data and add no runtime endpoint or reference-data population. Unknown/incomparable teams fail closed.

Revalidation of stored headshots covers every supplied row: 1497 rows and 320 HTTP 200 responses. Results: 1103 confirmed stored URLs, 388 mismatches, six ambiguous, zero unresolved. The differences artifact lists 57 unique resolutions to a different URL: 51 non-null stored URLs and six null URLs. Refusals alone do not prove wrong-person photos. All legacy player images remain on the branded fallback; the report authorizes no rewrite.

The existing `updateMetadata(player.id, { headshot_url: headshotUrl })` call and skip of existing string headshots are unchanged. `package.json` is a singleton held by WORK-2026103022 and out of scope. No new live DB test was added; no live DB enrichment proof is claimed.

No submission, distribution, outbox, worker, schema, contract, domain or approved-media-host file changed in this repair. No production connection, write, activation or deployment occurred.

Evidence uses schema_version 2 under explicit Production Claude direction, resolving the packet-v1/pre-merge-validator conflict. Static/full gate outcomes are in verification.md and review-gate-results.txt. Staging proof, exact-head CI, independent re-review and Griff's exact-head T1 verdict remain pending.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1822

The wrapper owns publication after Production Claude coordinates the staging slot. This executor commits locally and opens no PR, pushes no branch and publishes no READY_FOR_REVIEW attestation.
