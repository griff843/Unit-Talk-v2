# Proof — UTV2-919

**Issue:** UT-P0-006 Enforce Service-to-Service Authentication  
**Branch:** griffadavi/utv2-919-ut-p0-006-enforce-service-to-service-authentication  
**Merge SHA:** (to be populated after merge)  
**Date:** 2026-05-13

---

## Static Verification

| Check | Result |
|---|---|
| `pnpm type-check` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| `pnpm test` (all suites) | PASS — 144/0 fail (api suite), 113/0 fail (other suites) |
| New auth tests (auth.test.ts) | PASS — ingestor=settler, bot=submitter, identity prefix correct |
| New ingestor tests (triggerGradingRun) | PASS — header present with key, absent without |
| New bot tests (createApiClient) | PASS — Authorization header correct |

## P0 Protocol Checklist

- [x] Codex/Claude implementation lane
- [x] Claude critique written (`claude-critique.md`)
- [ ] Human PM approval (pending)
- [ ] Runtime verification (pending — requires live API + key injection)
- [x] No auto-merge (manual merge only)

## Acceptance Criteria Coverage

| Criterion | Status |
|---|---|
| No internal mutation path succeeds unauthenticated | Enforced: ingestor + bot now send Bearer; API fail-closed rejects absent keys |
| Auth failures are logged | Existing auth failure logging unchanged; `seller:ingestor.auth_missing` warning added |
| Tokens have scopes | ingestor=settler, bot=submitter, cc=operator (unchanged) |
| Raw key handling reduced/isolated | Keys flow through env → loadAuthConfig (existing pattern) |
