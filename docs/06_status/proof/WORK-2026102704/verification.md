# PROOF: WORK-2026102704

MERGE_SHA: pending merge

Issue: WORK-2026102704
Tier: T2
Branch: codex/work-2026102704-participant-media-api
Executor: codex-cli (codex-luna-medium; routing evidence in `model-routing.json`)
Head SHA (last non-proof commit): bd87cf595d3bf2981d05073cc6195842b36d36e0
result: pass

## ASSERTIONS:

- [x] `GET /api/reference-data/participants/:id/media` reads exactly one participant through `ParticipantRepository.findById`, with no write, enrichment or external fetch (`handlers/participant-media.test.ts`: "projects approved player media by canonical id").
- [x] A malformed (non-UUID) id returns 404 without repository access ("projects only team logo and rejects invalid ids without repository access").
- [x] Unknown, mismatched and non player/team participants return 404; a repository failure returns 503 without internal detail ("returns 404 for unknown, mismatched, or unsupported participants and 503 for repository failures").
- [x] Only HTTPS URLs on the allow-listed CDNs, with no credentials, port or fragment, are returned; anything else becomes `null` ("media URL policy allows approved HTTPS origins and rejects unsafe URLs").
- [x] The route is reachable over HTTP (`participant-media.http.test.ts`), and both test files are listed in `apps/api/package.json`.

## EVIDENCE:

```text
$ pnpm exec tsx --test apps/api/src/handlers/participant-media.test.ts apps/api/src/participant-media.http.test.ts
5 tests, 5 passed, 0 failed
```

Production data check (read-only, 2026-10-27): all 1,928 participant ids (405 teams, 1,523 players) match the handler's UUID pattern, so no real participant is refused by the new guard. Every stored headshot and logo uses an allow-listed host. Independent review (Claude orchestrator) found the response shape compatible with the merged Smart Form client, which reads `headshotUrl` for players and `logoUrl` for teams and treats a missing key as no image.

Writable live DB: not applicable to a read-only endpoint. The local run was refused by the staging identity guard as designed; the protected staging-ci proof runs in the required CI `verify` context.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record). Locally, Codex ran `pnpm verify:static`: PASS (static checks, build, aggregate tests, Smart Form 224 passed).
- `pnpm type-check` (`pnpm --filter @unit-talk/api type-check`): PASS
- `pnpm test` (focused participant-media handler and HTTP tests): 5/5 PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no R-level rules matched

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1794
Execution SHA: bd87cf595d3bf2981d05073cc6195842b36d36e0
