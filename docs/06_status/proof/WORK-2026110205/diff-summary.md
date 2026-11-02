# Diff summary: WORK-2026110205

| File | Change |
|---|---|
| apps/api/src/player-enrichment-service.ts | One shared normalized full-name matcher requires exactly one credible candidate; compares available team/league identities (including ESPN relationship fields); counts ambiguity, identity mismatch and provider failures in run details. |
| apps/api/src/player-enrichment-service.test.ts | Three regressions written before service changes, four-sport normalization/suffix/duplicate/team/league cases, refusal accounting and stored-image preservation. |
| apps/smart-form/lib/participant-media.ts | Rejects legacy player URLs because the media response provides no image identity evidence; approved-host and participant-envelope checks remain intact. |
| apps/smart-form/app/submit/components/ParticipantArtwork.tsx | Approved BrandLogo emblem geometry replaces initials, including load failures; accessible participant names remain. |
| apps/smart-form/test/participant-media.test.ts | Ensures even approved-host legacy player photos cannot bypass fallback. |
| docs/06_status/proof/WORK-2026110205/* | Measured regression/mutation outputs, live provider raw responses, browser evidence and pending gates. |

Rework implementation source: `d7d268369` (full SHA in evidence.json).

The current read endpoint has no identity-verification contract. All player headshots therefore remain on the emblem, including stored URLs that might later be confirmed by revalidation. This deliberately avoids displaying stored wrong-person photos without adding a write or widening endpoint scope. Team logos retain the existing approved-host/participant checks.

The existing `updateMetadata(player.id, { headshot_url: headshotUrl })` call and skip of existing string headshots are unchanged. No stored headshot is rewritten. `package.json` is a singleton held by WORK-2026103022 and is out of scope; no new live DB test is added, and this proof makes no live DB enrichment claim.

No submission, distribution, outbox, worker, schema, contract, domain or approved-media-host file changed. No production DB connection, write, provider activation or deployment occurred.

## SHA Binding

Merge SHA: pending merge; only the authorized post-merge path may bind it.
PR: pending; Production Claude opens it when the staging slot is free.

## Authorized rework and read-only proof

Production Claude authorized the two discovered repairs in `.out/media-0205/REWORK-DIRECTIONS.md`: compare canonical team keys by full provider names/nicknames, compare numeric provider IDs only within their namespace, and resolve NBA columns by header names. Added regressions for canonical matches, Sox distinction, LA Clippers, numeric conflicts, reordered headers and the six-Jakes shared-photo case. Rework baseline: 14 pass / 3 fail. Repaired focused suite: 24/24.

Revalidation of stored headshots covers 1497 rows with 320 HTTP 200 responses: 1260 confirmed stored URLs, 229 mismatches, 8 ambiguous, 0 unresolved. The separate URL-differences file lists all 55 unique resolutions to different URLs (MLB 7, NBA 2, NHL 46). Of the 55 differences, 47 replace a non-null stored URL and eight would fill a null URL; null URLs are not wrong-photo cases. Refusals do not establish wrong-person photos. Missing comparable provider team names contribute no identity evidence; a unique normalized full name and all comparable available team/league checks still govern.

Evidence now uses schema_version 2 under explicit outer-authority direction, resolving the packet-v1/pre-merge-validator conflict. Staging proof, CI and approvals remain pending. No push or PR in this rework.
