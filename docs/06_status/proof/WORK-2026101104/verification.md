# PROOF: WORK-2026101104

MERGE_SHA: 44a7092dea87d2291da75f984c86829a8c6f6f0f

Issue: WORK-2026101104
Tier: T2
result: pass

## ASSERTIONS:

- [x] A bot-key submitter (identity prefix `submitter:discord-bot:`) may sync member tiers; a generic submitter key stays 403 (member-picks.test.ts).
- [x] The bot may write only trial, vip and vip-plus; capper, operator and free are refused 403 TIER_NOT_BOT_SYNCABLE (member-picks.test.ts).
- [x] A failed sync is visible as member_tier_sync.failed with HTTP status and a bounded code; key and response body are never logged (discord-bot-foundation.test.ts).
- [x] Each guard is pinned by a test that fails when the guard is removed (8 mutation checks, below).

## EVIDENCE:

Tests run on code commit 44a7092dea87d2291da75f984c86829a8c6f6f0f:

```
member-picks.test.ts              24/24 pass
discord-bot-foundation.test.ts   110/110 pass
http-integration + server tests   93/93 pass
pnpm type-check                  clean
pnpm lint                        clean
```

Mutation checks (each makes member-picks.test.ts fail): prefix check removed (4 fail); loosened to `submitter:` (4); source not forced (1); audit action renamed (2); tiers widened to capper/operator (1); snowflake check removed (1); only server gate removed (1); only handler check removed (1).

CI at this head: `verify` and `Writable DB proof (staging only)` passed (workflow run 38160723238).

## Verification

Commands executed on the final code commit: the three test groups above, `pnpm type-check`, `pnpm lint`, and the 8 mutation runs. The one failing test in `server.http.test.ts` ("POST /api/submissions with valid body returns 201") fails identically on a clean origin/main and is not registered in any test script.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1740
