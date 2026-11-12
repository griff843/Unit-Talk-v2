# PROOF: WORK-2026102705

MERGE_SHA: e095bb926a79c8b2babf36e973555bc9dca8ae1b

Issue: WORK-2026102705
Tier: T2
Branch: claude/work-2026102705-smart-form-artwork
Head SHA (last non-proof commit): 9a8e2558458f21dd712674741963954a91dfd0d5
result: pass

The implementation is Codex-authored and carried unchanged from draft PR #1791 (head c1c6e8843), `apps/smart-form` half only. Griff approved the design on 2026-10-27. The `apps/api` media endpoint is the separate lane WORK-2026102704.

## ASSERTIONS:

- [x] Media is resolved only by exact canonical participant id. A response with a mismatched id, type or sport is discarded (`test/participant-media.test.ts`).
- [x] Only HTTPS URLs on the allow-listed image CDNs are rendered; credentialed, ported, fragment or other-host URLs become `null` (`test/participant-media.test.ts`).
- [x] A failed fetch, missing endpoint or broken image yields an initials fallback and never affects form validity or payload (`lib/participant-media.ts` catch path, `ArtworkImage` onError; `test/participant-media.test.ts`).
- [x] Stale artwork from a previous selection is never shown: render-time identity comparison and an aborted fetch on change (`ParticipantArtwork.tsx`).
- [x] Stat and sport input examples are covered by `test/input-examples.test.ts`.
- [x] No change to payload construction, auth, source, provenance or Track Only (`lane:check delivery-ui` PASS, 15 files). Selection is stricter, though. Player suggestions are scoped to the selected team's participant id, and a stale suggestion or selection for a previous scope is ignored (`BetForm.tsx`). Since UTV2-1856 the player-search `teamId` is a participants id, and production `teams` has 0 rows, so the scoping matches the API's own server-side `teamId` filter. Covered by the existing Smart Form suite (224/224).

## EVIDENCE:

```text
$ cd apps/smart-form && pnpm test
# tests 224
# pass 224
# fail 0
```

```text
$ pnpm lane:check --lane delivery-ui --base origin/main --head HEAD
lane:check PASS lane=delivery-ui files=15
```

Browser evidence: Codex's fixture run (experience-qa/v1, status PASS) at 1440, 390 and 320px, with no horizontal overflow and no submission attempted. It is carried unchanged in `browser-evidence-*` files, originally `apps/qa-agent/artifacts/work-2026102703/`, and was recorded on Codex head f03d9be42, whose `apps/smart-form` content is identical to this lane's.

Production data check (read-only, 2026-10-27): every participant row with artwork uses an allow-listed host. NHL 318/318 players with headshots and 32/32 teams with logos; MLB 951/951 and 30/30; NBA 228/254 and 29/30; NFL 32/32 team logos; WNBA 0/15 team logos, which fall back to initials.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record). A local `pnpm verify` cannot exit 0 outside CI because its staging identity guard (`ci:assert-staging`) requires the staging-ci environment.
- `pnpm type-check`: exit 0
- `pnpm test` (`apps/smart-form`): 224/224 pass
- eslint on the changed components, lib and tests: clean
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, rules matched: operator-ui

## Merge SHA Binding

Merge SHA: e095bb926a79c8b2babf36e973555bc9dca8ae1b
PR: https://github.com/griff843/Unit-Talk-v2/pull/1793
Execution SHA: 9a8e2558458f21dd712674741963954a91dfd0d5
