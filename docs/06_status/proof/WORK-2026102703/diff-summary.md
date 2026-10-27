# Diff summary: WORK-2026102703

| File | Change |
|---|---|
| `apps/command-center/src/lib/server-api.ts` | Adds `basicActor`: the explicit identity if one is configured, otherwise the Basic username if it is canonical, otherwise the default. The Basic branch authenticates as `basicActor`; bearer is unchanged. |
| `apps/command-center/src/lib/session-auth.ts` | A session verifies only for an actor the configured credentials can produce: the token identity and/or `basicActor`. |
| `apps/command-center/src/lib/server-api.test.ts` | Tests for canonical-username attribution, non-canonical fallback, explicit-identity precedence, the unchanged bearer path and credential refusal. |
| `apps/command-center/src/lib/session-auth.test.ts` | Tests for session actor by credential and for invalidation when the Basic user is renamed. |
| `.ops/work/WORK-2026102703.md` | Work order. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1792
