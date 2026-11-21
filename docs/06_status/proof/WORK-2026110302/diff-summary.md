# Diff summary: WORK-2026110302

| File | Change |
|---|---|
| packages/domain/src/discord-presentation.ts | `mediaUrl` replaced by exported `allowedMediaUrl` with a frozen four-host allowlist (`DISCORD_MEDIA_HOST_ALLOWLIST`); https only, no credentials, no non-default port. All builders use it. |
| packages/domain/src/discord-presentation.test.ts | New: allowlist, refusals, builders and recap go through the guard. |
| apps/worker/src/delivery-adapters.ts | `buildDiscordMessagePayload` only: thumbnail passed only when `metadata.thumbnailVerified === true`. |
| apps/worker/src/delivery-adapters.test.ts | Unverified, non-boolean flag, dead host and verified cases; adapter still sends. |
| apps/api/src/pick-asset-resolver.ts | Rewritten: `resolvePickArtwork({ participantId, marketKey })` binds by ID, re-verifies player headshots with `resolveHeadshot`, team logo only for that team, no game totals, 5s overall deadline, returns `{ url, verified }`, no write-back. |
| apps/api/src/pick-asset-resolver.test.ts | New: 17 resolver tests. |
| apps/api/src/submission-service.ts | Both call sites pass the resolved participant ID; caller `thumbnailUrl`/`thumbnailVerified` stripped; `thumbnailVerified` set only from the resolver; optional trailing `artworkOptions` test seam. Otherwise unchanged. |
| apps/api/src/submission-service.test.ts | Seven submission-level regressions. |
| apps/api/src/t1-proof-work-2026110302-artwork-metadata-live.test.ts | New staging-only suite: persisted `thumbnailVerified`, stripped caller artwork, no outbox rows. |
| package.json | Registers the three unit test files and the staging suite. |
| docs/05_operations/db-writer-classification.json | Classifies the staging suite under `pnpm test:t1-proof:live`. |
| docs/05_operations/executable-wiring-baseline.json | Removes the stale `delivery-adapters.test.ts` entry now that it is wired. |
| apps/discord-bot/src/discord-design-system.test.ts | Test data only: sample image host changed to an allowlisted host. |
| docs/06_status/lanes/WORK-2026110302.json | File scope lock extended with the Griff-authorized paths. |

## SHA Binding

Merge SHA: pending merge
PR: pending
