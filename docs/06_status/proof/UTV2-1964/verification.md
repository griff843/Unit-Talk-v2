# PROOF: UTV2-1964

MERGE_SHA: pending merge

Issue: UTV2-1964
Tier: T2
result: blocked

## ASSERTIONS:

- [x] Registration uses only `Routes.applicationGuildCommands` and replaces the full configured guild inventory.
- [x] An empty authored manifest is refused before any REST request can wipe the registry.
- [x] The token's current application identity must match `DISCORD_CLIENT_ID` before replacement.
- [x] Read-back verifies inventory count, unique command names, application/guild identity, and all authored nested fields while tolerating Discord-omitted defaults.
- [x] Importing the module does not register commands, and the CLI failure path emits no raw REST error or credential.
- [x] The implementation and focused test are byte-identical to the two accepted files in commit `2c56becfe8ff1be9dfbc2313c78d637962522bda`.
- [ ] The new test is executable from a package/workflow command. The final gate correctly refuses it because `apps/discord-bot/package.json` is outside this lane's authorized scope and no explicit PM response has authorized the pending minimal wiring edit.

## EVIDENCE:

Execution SHA: `4bc8f3d6b3e9c71fcaf8a07d0d02ff2ad06ae704`

Focused suite:

```text
tests 8
pass 8
fail 0
```

Final executable-wiring result:

```text
[executable-wiring] verdict=FAIL
[FAIL] WIRING_TEST_UNWIRED_NEW apps/discord-bot/scripts/deploy-commands.test.ts
test file is not reachable from any package script or workflow command
```

R-level compliance:

```text
Verdict: PASS
Changed files: 6
Rules matched: discord-delivery
```

## Verification

- `pnpm exec tsx --test 'apps/discord-bot/scripts/deploy-commands.test.ts'` — PASS, 8/8.
- `pnpm --filter @unit-talk/discord-bot type-check` — PASS.
- `pnpm lint` — PASS.
- `pnpm test` — PASS.
- `pnpm verify:static` before the source commit — PASS, but not accepted as final evidence because the executable-wiring scan did not include the then-untracked test.
- `pnpm verify` on committed source SHA `4bc8f3d6b3e9c71fcaf8a07d0d02ff2ad06ae704` — FAIL at `ops:automation-coverage-check`; the new test is not wired into any package or workflow command. No later stages were claimed.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; `discord-delivery` matched, R1 required, no artifact requirement.
- Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx` and must run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. This lane performs no DB operation.

## Blocker

The smallest fix is a minimal test-script wiring change in
`apps/discord-bot/package.json`. The work packet explicitly says that authorization is pending and
forbids editing that file without an explicit response. The authoritative PR discussion contains
no later PM authorization, so the lane cannot truthfully reach a green final gate or open a
reviewable PR within its current file-scope lock.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 4bc8f3d6b3e9c71fcaf8a07d0d02ff2ad06ae704
