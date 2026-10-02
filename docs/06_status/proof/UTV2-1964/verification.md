# PROOF: UTV2-1964

MERGE_SHA: 35f9db79e85f5f67692b5ffb29ad471408c7361d

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
- [x] The new test is executable from the Discord bot package command and the repository executable-wiring guard passes.
- [ ] File Scope Lock accepts the PM-authorized `apps/discord-bot/package.json` edit. The human approval requires an external `scope-override/v1` comment bound to the eventual PR number and exact final head SHA.

## EVIDENCE:

Execution SHA: `9097cfc0b1dac0598c8cc64d99f17115494255ce`

Focused suite:

```text
tests 8
pass 8
fail 0
```

Final executable-wiring result:

```text
[executable-wiring] verdict=PASS required_roots=verify
optional-reachable=56 unwired=119 (baselined=119 new=0)
```

R-level compliance:

```text
Verdict: PASS
Changed files: 9
Rules matched: discord-delivery
```

## Verification

- `pnpm exec tsx --test 'apps/discord-bot/scripts/deploy-commands.test.ts'` — PASS, 8/8.
- `pnpm --filter @unit-talk/discord-bot test` — PASS, 8/8 through the added package command.
- `pnpm --filter @unit-talk/discord-bot type-check` — PASS.
- `pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --esModuleInterop --skipLibCheck apps/discord-bot/scripts/deploy-commands.ts apps/discord-bot/scripts/deploy-commands.test.ts` — PASS under the admitted Codex CLI execution.
- `pnpm type-check` — PASS as executed by `pnpm verify:static`.
- `pnpm test` — PASS as executed by `pnpm verify:static`.
- `pnpm verify:static` — PASS after the PM-authorized package wiring; this includes executable wiring, lint, repository type-check, build, full test, Smart Form verification, and command verification.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; `discord-delivery` matched, R1 required, no artifact requirement.
- `pnpm exec tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch codex/utv2-1964-guild-registration --manifest-source git --head-sha 9097cfc0b1dac0598c8cc64d99f17115494255ce` — expected FAIL only for `apps/discord-bot/package.json`; the historical two-file lock is intentionally preserved until the PM posts the exact-head external override.
- Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx` and must run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. This lane performs no DB operation.

## Blocker

The human PM explicitly authorized the minimal `apps/discord-bot/package.json` test wiring while
preserving the historical two-file lock. Per that decision, the remaining blocker is the external
`scope-override/v1` PR comment, which must name the PR number and exact final head SHA. The PR is
opened first so that immutable binding can be supplied without weakening repository policy.

## Merge SHA Binding

Merge SHA: 35f9db79e85f5f67692b5ffb29ad471408c7361d
PR: pending
Execution SHA: 9097cfc0b1dac0598c8cc64d99f17115494255ce
