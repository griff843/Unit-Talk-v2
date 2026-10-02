# PROOF: UTV2-1965

MERGE_SHA: pending merge

Issue: UTV2-1965
Tier: T1
result: pre_merge

## ASSERTIONS:

- [x] Only the production `promote` job registers commands; canary and every other job contain no registration step.
- [x] The production `verify` preflight requires `DISCORD_GUILD_ID` to be a nonzero, no-leading-zero, 17-20 digit unsigned-64-bit Discord snowflake before canary or production activation can begin; missing, zero/all-zero, out-of-range, malformed, and whitespace-wrapped values fail closed without echoing the supplied value.
- [x] Registration runs after production health/containment confirmation and before non-blocking image cleanup; downstream smoke still requires successful `promote` completion.
- [x] The remote shell verifies `.unit-talk-release`, resolves the running `discord-bot` container, and verifies its exact image namespace/tag before execution.
- [x] The promoted container runs `/repo/apps/discord-bot/scripts/deploy-commands.ts`; its existing guild-only application identity, full replacement, safe failure logging, and manifest read-back remain authoritative and unchanged.
- [x] Bash strict mode and the absence of `continue-on-error` propagate registration failure and prevent successful promotion/smoke acceptance.
- [x] The extracted real heredoc passes against fake Docker and refuses a registry exit, stale release tag, and stale image without exposing credentials or raw REST errors.
- [x] Both focused regression files are reachable from the existing required package test gates without removing any existing test.
- [x] The implementation preserves the accepted deployment behavior from predecessor commit `2c56becfe8ff1be9dfbc2313c78d637962522bda` on current main.
- [x] Fresh source-head sanctioned CI run `37028592696` asserted staging project `xskgrzbteyqdufktjrjx`, passed writable DB proof 7/7 and all T1 live proof suites, uploaded receipt artifact `11236897489`, and passed dependent static/Command Center verification plus same-run receipt validation.

## EVIDENCE:

Execution SHA: `b1fc2fe2fb3bb99beca507270200f0b832dea241`

Focused workflow-shell suite:

```text
tests 5
pass 5
fail 0
```

Authoritative bot registration suite:

```text
tests 8
pass 8
fail 0
```

Static verification:

```text
pnpm verify:static
exit 0
full repository test suite passed, 0 failed
command manifest: 14 definitions verified
```

R-level compliance:

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

- `pnpm exec tsx --test scripts/ci/deploy-discord-commands.test.ts` — PASS, 5/5, including the selected production ID and uint64 max acceptance plus real-shell missing, zero/all-zero, leading-zero, 20-nines, max+1, malformed, and whitespace refusal cases.
- `pnpm exec tsx --test scripts/ci/deploy-discord-commands.test.ts scripts/ci/deploy-parked-mode.test.ts` — PASS, 39/39; the new dedicated preflight preserves the existing deployment workflow contract.
- `pnpm exec tsx --test apps/discord-bot/scripts/deploy-commands.test.ts` — PASS, 8/8.
- `pnpm exec prettier --check .github/workflows/deploy.yml package.json scripts/ci/deploy-discord-commands.test.ts` — PASS.
- `pnpm verify:static` — PASS; includes lint, type-check, build, full `pnpm test`, local T1 proofs, Smart Form verification, command verification, and static governance checks.
- `pnpm verify` — static portion PASS; then BLOCKED/DEFERRED at the same staging-target enforcement described below, before any writable DB test or mutation.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R-level rule matched and no R-level artifact is required.
- `pnpm test:db` — BLOCKED/DEFERRED before test execution by staging-target enforcement. Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. The local command observed `host=127.0.0.1`, `ref=unidentified`, and made no DB write.
- Fresh source-head hosted CI run `37028592696`, DB job `110909890025`, and verify job `110914062058` — PASS. The approved staging identity was asserted, `pnpm test:db` passed 7/7, all T1 live proof suites passed, and receipt artifact `11236897489` was uploaded. The dependent verify job passed static and Command Center verification and validated the same-run receipt. The receipt records PR merge ref SHA `b68dd464b5c574e2f48eba56dab56168f25c04e0` for execution head `b1fc2fe2fb3bb99beca507270200f0b832dea241`.

## Runtime proof boundary

The runtime-shaped behavior is proven by executing the exact workflow heredoc against fake Docker.
No production deployment, Discord REST call, registry mutation, persona retest, watched delivery, or
database mutation was authorized or performed.

## Predecessor provenance

This PR supersedes only the deployment/test-wiring slice from `griff843/Unit-Talk-v2#1705`
(UTV2-1963) through the sanctioned replacement path. It follows UTV2-1964/#1706 merge
`35f9db79e85f5f67692b5ffb29ad471408c7361d` and trusted closeout
`5051245de0b4d92d59caffbe464fb09b419ab120`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1707
Execution SHA: b1fc2fe2fb3bb99beca507270200f0b832dea241
