# Diff summary: WORK-2026110205

| File | Change |
|---|---|
| apps/api/src/player-enrichment-service.ts | One shared normalized full-name matcher requires exactly one credible candidate; compares available team/league identities; counts ambiguity, identity mismatch and provider failures in run details. |
| apps/api/src/player-enrichment-service.test.ts | Three regressions written before service changes, four-sport normalization/suffix/duplicate/team/league cases, refusal accounting and stored-image preservation. |
| apps/smart-form/lib/participant-media.ts | Rejects legacy player URLs because the media response provides no image identity evidence; approved-host and participant-envelope checks remain intact. |
| apps/smart-form/app/submit/components/ParticipantArtwork.tsx | Approved BrandLogo emblem geometry replaces initials, including load failures; accessible participant names remain. |
| apps/smart-form/test/participant-media.test.ts | Ensures even approved-host legacy player photos cannot bypass fallback. |
| docs/06_status/proof/WORK-2026110205/* | Measured regression/mutation outputs, live provider raw responses, browser evidence and pending gates. |

Implementation source: `1ec1af6b6` (full SHA in evidence.json).

The current read endpoint has no identity-verification contract. All player headshots therefore remain on the emblem, including stored URLs that might later be confirmed by revalidation. This deliberately avoids displaying stored wrong-person photos without adding a write or widening endpoint scope. Team logos retain the existing approved-host/participant checks.

The existing `updateMetadata(player.id, { headshot_url: headshotUrl })` call and skip of existing string headshots are unchanged. No stored headshot is rewritten. `package.json` is a singleton held by WORK-2026103022 and is out of scope; no new live DB test is added, and this proof makes no live DB enrichment claim.

No submission, distribution, outbox, worker, schema, contract, domain or approved-media-host file changed. No production DB connection, write, provider activation or deployment occurred.

## SHA Binding

Merge SHA: pending merge; only the authorized post-merge path may bind it.
PR: pending; Production Claude opens it when the staging slot is free.
