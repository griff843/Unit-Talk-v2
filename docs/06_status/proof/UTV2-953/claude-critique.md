# Claude Critique — UTV2-953

**Issue:** UTV2-953 Runtime-mode env documentation — P0 follow-up  
**Lane tier:** T3 (docs-only)  
**Branch:** claude/utv2-953-runtime-mode-env-docs  
**Merge SHA:** df82550f243ccb7a5b8b5b2c8a2175976362e825  
**Reviewer:** Claude Sonnet 4.6  
**Date:** 2026-05-14

---

## Change Summary

Three files modified:

1. `.env.example` — adds 4 missing service runtime mode vars (`UNIT_TALK_WORKER_RUNTIME_MODE`, `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE`, `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE`, `UNIT_TALK_OPERATOR_RUNTIME_MODE`) and annotates all existing `*_RUNTIME_MODE` and `UNIT_TALK_APP_ENV` vars with inline comments describing valid values and fail-closed trigger conditions.
2. `docs/05_operations/RUNTIME_MODE_REF.md` — new operator one-pager documenting all runtime-mode variables with a quick-reference table, per-variable detail section, startup failure codes, and production checklist.
3. `docs/05_operations/docs_authority_map.md` — adds `RUNTIME_MODE_REF.md` entry in Wave 1 Hardening Contracts.

Incidental fix: UTF-8 BOM stripped from `package.json` (pre-existing bug that blocked all tsx-based scripts under Node.js v24.14.1 + tsx v4.21.0).

---

## Accuracy Review

**Variables documented in `RUNTIME_MODE_REF.md`** were verified against `packages/config/src/env.ts`:

| Var | Exists in AppEnv interface | Default logic correct |
|---|---|---|
| `UNIT_TALK_APP_ENV` | ✅ line 5 | ✅ local/ci/staging/production |
| `UNIT_TALK_API_RUNTIME_MODE` | ✅ line 60 | ✅ optionalEnv, fail_open default |
| `UNIT_TALK_INGESTOR_RUNTIME_MODE` | ✅ line 59 | ✅ optionalEnv, fail_open default |
| `UNIT_TALK_WORKER_RUNTIME_MODE` | ✅ line 61 | ✅ optionalEnv, fail_open default |
| `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE` | ✅ lines 62-234 | ✅ optionalEnv, fail_open default |
| `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE` | ✅ lines 63-236 | ✅ optionalEnv, fail_open default |
| `UNIT_TALK_OPERATOR_RUNTIME_MODE` | ✅ line 73 | ✅ used by command-center auth chain |
| `COMMAND_CENTER_AUTH_MODE` | ✅ (COMMAND_CENTER_* group) | ✅ fail_open local default |

**Enforcement logic** verified against `assertProductionRuntimeConfig()` in `packages/config/src/env.ts`:
- `isProductionLikeRuntime()` correctly gates on `staging` or `production` — ✅ documented accurately
- Error codes `RUNTIME_MODE_REQUIRED`, `RUNTIME_MODE_INVALID`, `RUNTIME_MODE_MUST_FAIL_CLOSED` — ✅ all present at lines 321-323
- `UNIT_TALK_OPERATOR_RUNTIME_MODE` as command-center fallback — ✅ verified in `apps/command-center/src/lib/server-api.ts` line 270

---

## Risk Assessment

**Risk: None identified.**

- No code changes. No logic changes. Documentation only (plus BOM fix).
- BOM fix: `package.json` is byte-identical except for the 3-byte BOM prefix removal. `JSON.parse` and all tooling treat the result identically. Pre-existing issue; does not change any build outputs.
- `.env.example` additions: template file only. No service reads `.env.example` at runtime — it is for operator reference. Adding vars with `fail_open` defaults cannot tighten any production constraint.
- `RUNTIME_MODE_REF.md` contents: purely informational; does not change any enforcement behaviour.

---

## Verdict

**APPROVED — no concerns.** Documentation is accurate, scope is contained, no runtime risk.
