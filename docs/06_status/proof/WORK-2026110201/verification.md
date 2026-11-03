# PROOF: WORK-2026110201

MERGE_SHA: e95027e79e96604a0e285a8c13acdd7be6628831
Execution SHA: eece61514d6409c747daa2b047fa5d2cd450d90c

Issue: WORK-2026110201
Tier: T2
Verified source: `eece61514d6409c747daa2b047fa5d2cd450d90c`
Executor: Codex via `pnpm ops:codex-exec` (implementation at `7d234b59e`), plus one Production Claude review correction (`eece61514`, Capper field heading).

## Verification

ASSERTIONS:
- [x] `/help` lists exactly `/stats`, `/leaderboard` and `/trial-status` with the binding descriptions and both support links. `/pick`, operator controls, deferred tools and `/upgrade` are absent.
- [x] `/trial-status` uses the binding description for Free, Trial, VIP, VIP+ and the reserved tier.
- [x] Only `isCapper` adds the **Submitting picks** field, which links to the Smart Form.
- [x] Tier resolution, role guards, command registration and private visibility are unchanged. The diff is static text plus tests.

EVIDENCE:

```text
pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts   # at eece61514
# tests 115
# pass 115
# fail 0
```

- Codex run at `7d234b59e`: `pnpm type-check`, `pnpm test` and `pnpm verify:static` passed (exit 0). `r-level-check` passed, matching `discord-delivery` (R1 static).
- After the review correction (`eece61514`), the focused foundation suite was rerun: 115/115.
- Exact-head CI (`verify` and `Writable DB proof (staging only)`) is recorded in the executor-result comment for the exact PR head.


## Focused foundation suite

Command: `pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts`

Result: PASS, 115 tests, 115 passed, 0 failed.

The suite covers the exact `/help` entries and support links, absence of `/pick` and excluded commands from member help, the prepared copy for all five resolved tiers, Capper Smart Form copy, and the existing private trial-status response behavior.

## Type check and repository tests

- `pnpm type-check`: PASS (exit 0).
- `pnpm test`: PASS (exit 0).

## Static verification

`pnpm verify:static`: PASS (exit 0). The command manifest verified 14 definitions; 139 migration versions were verified, and 138 forward migration files passed migration lint. Static verification did not run the optional Smart Form browser E2E because `UNIT_TALK_SMART_FORM_E2E` was not set. Existing automation-coverage baseline warnings were reported; no new warning was attributed to this change.

Command: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

Result: PASS; 9 changed files matched the `discord-delivery` rule. Its required R1 static verification passed; the rule defines no separate R-level artifacts.

## Writable live DB

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials. No writable DB verification was attempted.

## Executor notes

The lane packet says not to open a pull request. Production Claude opens it when the staging slot is free. This child executor does not publish an `executor-result/v1` READY_FOR_REVIEW attestation; the outer executor wrapper owns that publication after its execution-truth checks.

## Merge SHA Binding

Merge SHA: `e95027e79e96604a0e285a8c13acdd7be6628831`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1818
