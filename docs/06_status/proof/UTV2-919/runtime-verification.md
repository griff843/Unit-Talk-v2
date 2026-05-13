---
result: pass
---

# Runtime Verification — UTV2-919

**Issue:** UT-P0-006 Enforce Service-to-Service Authentication  
**Branch:** griffadavi/utv2-919-ut-p0-006-enforce-service-to-service-authentication  
**Verified by:** Claude (orchestrator) — 2026-05-13

---

## Runtime Checks

- [x] `loadAuthConfig treats UNIT_TALK_INGESTOR_API_KEY as a settler key`: PASS
  - Test: `apps/api/src/auth.test.ts` — confirmed via `npx tsx --test`, 24/24 pass
  - Identity maps to `settler` role; route guard allows `/api/grading/run`
- [x] `loadAuthConfig treats UNIT_TALK_BOT_API_KEY as a submitter key`: PASS
  - Test: `apps/api/src/auth.test.ts` — confirmed, `submitter` role, `/api/submissions` accessible
- [x] `triggerGradingRun sends Authorization header when apiKey provided`: PASS
  - Test: `apps/ingestor/src/ingestor.test.ts` — 85/85 pass
  - Header `Authorization: Bearer <key>` present in mocked fetch request
- [x] `triggerGradingRun omits Authorization header when no apiKey`: PASS
  - Test: ingestor.test.ts — confirmed no header when key absent (backward compatible)
- [x] `createApiClient sends Authorization header when apiKey provided`: PASS
  - Test: `apps/discord-bot/src/discord-bot-foundation.test.ts` — 91/91 pass
- [x] `createApiClient omits Authorization header when no apiKey`: PASS
  - Test: discord-bot-foundation.test.ts — confirmed

## Evidence

All targeted unit tests pass. Auth header injection is verified at the unit level for all three callers. Role assignment verified at the API auth-config level.

```
apps/api/src/auth.test.ts:         24/24 pass
apps/ingestor/src/ingestor.test.ts: 85/85 pass (includes 2 new auth tests)
apps/discord-bot/src/discord-bot-foundation.test.ts: 91/91 pass (includes 2 new auth tests)
```

*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
