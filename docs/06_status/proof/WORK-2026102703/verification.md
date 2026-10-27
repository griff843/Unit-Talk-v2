# PROOF: WORK-2026102703

MERGE_SHA: pending merge

Issue: WORK-2026102703
Tier: T2
Branch: claude/work-2026102703-cc-operator-identity
Head SHA (last code commit): 1a3f8e5084ec15f1719b4233c4cf2f147d72a766
result: pass

## ASSERTIONS:

- [x] With no `COMMAND_CENTER_OPERATOR_IDENTITY`, a Basic login authenticates as its username when that username is already a canonical id (`server-api.test.ts`: "Basic login without an explicit identity authenticates as the canonical username").
- [x] A non-canonical username (`Griff843`, `griff 843`, `ops@example.com`, `-griff`) is never repaired into an identity; it keeps the default actor `command-center` (`server-api.test.ts`).
- [x] An explicit `COMMAND_CENTER_OPERATOR_IDENTITY` still wins for Basic login (`server-api.test.ts`, `ops-alice`).
- [x] Bearer authentication is unchanged and stays `command-center` (`server-api.test.ts`, `session-auth.test.ts`).
- [x] Wrong or missing credentials are refused (`server-api.test.ts`).
- [x] A browser session minted from a Basic login carries that operator; a bearer-minted session carries `command-center`. Renaming the Basic user invalidates existing sessions (`session-auth.test.ts`).

## EVIDENCE:

```text
$ cd apps/command-center && pnpm -s test
ℹ tests 694
ℹ pass 694
ℹ fail 0
```

```text
Mutation drill:
- reverting the Basic branch to `actor: config.operatorIdentity` turns the new server-api and session-auth tests red;
- reverting the session `issuable` set to the operatorIdentity-only check turns the session tests red;
- both were restored, and the tests are green again.
```

## Verification

- `pnpm type-check`: exit 0
- `pnpm test` (Command Center lib suite, `apps/command-center`): 694/694 pass
- eslint on the 4 changed source/test files: clean
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head claude/work-2026102703-cc-operator-identity`: Verdict PASS, rules matched: operator-ui

Runtime verification: this change takes effect only after the owner sets `COMMAND_CENTER_AUTH_USERNAME`/`COMMAND_CENTER_AUTH_PASSWORD` and authorizes a production deploy. Runtime settlement attribution is verified after that deploy, on genuine records; it is not claimed here.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1792
Execution SHA: 1a3f8e5084ec15f1719b4233c4cf2f147d72a766
