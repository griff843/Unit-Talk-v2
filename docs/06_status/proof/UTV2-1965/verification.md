# PROOF: UTV2-1965

MERGE_SHA: pending merge

Issue: UTV2-1965
Tier: T1
result: pre_merge

## ASSERTIONS:

- [x] Only the production `promote` job registers commands; canary and every other job contain no registration step.
- [x] Registration runs after production health/containment confirmation and before non-blocking image cleanup; downstream smoke still requires successful `promote` completion.
- [x] The remote shell verifies `.unit-talk-release`, resolves the running `discord-bot` container, and verifies its exact image namespace/tag before execution.
- [x] The promoted container runs `/repo/apps/discord-bot/scripts/deploy-commands.ts`; its existing guild-only application identity, full replacement, safe failure logging, and manifest read-back remain authoritative and unchanged.
- [x] Bash strict mode and the absence of `continue-on-error` propagate registration failure and prevent successful promotion/smoke acceptance.
- [x] The extracted real heredoc passes against fake Docker and refuses a registry exit, stale release tag, and stale image without exposing credentials or raw REST errors.
- [x] Both focused regression files are reachable from the existing required package test gates without removing any existing test.
- [x] The implementation preserves the accepted deployment behavior from predecessor commit `2c56becfe8ff1be9dfbc2313c78d637962522bda` on current main.
- [ ] Sanctioned `staging-ci` produces and binds the required writable T1 DB receipt for project `xskgrzbteyqdufktjrjx`.

## EVIDENCE:

Execution SHA: `21c45451fa8df4bd18ea6bf0b34ee7859bc888c9`

Focused workflow-shell suite:

```text
tests 3
pass 3
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
repository tests: 3567 passed, 0 failed
command manifest: 14 definitions verified
```

R-level compliance:

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

- `pnpm exec tsx --test scripts/ci/deploy-discord-commands.test.ts` — PASS, 3/3.
- `pnpm exec tsx --test apps/discord-bot/scripts/deploy-commands.test.ts` — PASS, 8/8.
- `pnpm exec prettier --check .github/workflows/deploy.yml package.json scripts/ci/deploy-discord-commands.test.ts` — PASS.
- `pnpm verify:static` — PASS; includes lint, type-check, build, full `pnpm test`, local T1 proofs, Smart Form verification, command verification, and static governance checks.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R-level rule matched and no R-level artifact is required.
- `pnpm test:db` — BLOCKED/DEFERRED before test execution by staging-target enforcement. Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. The local command observed `host=127.0.0.1`, `ref=unidentified`, and made no DB write.

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
PR: pending
Execution SHA: 21c45451fa8df4bd18ea6bf0b34ee7859bc888c9
