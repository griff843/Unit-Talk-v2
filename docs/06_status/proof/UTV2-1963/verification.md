# PROOF: UTV2-1963

MERGE_SHA: pending merge

Issue: UTV2-1963
Tier: T2
Lane type: runtime
Branch: codex/utv2-1963-discord-command-registration
result: not_run

## ASSERTIONS:

- [x] Production promotion invokes guild registration after containment confirmation and before smoke acceptance.
- [x] Requested release and running bot image must match before registration.
- [x] Token application identity is checked before guild-only full replacement; no global write route.
- [x] Read-back verifies all authored command fields, identities, count and names; stale/missing/duplicate/drifting commands fail.
- [x] Registration failure exits nonzero and fails promotion without logging raw REST errors or credentials.
- [x] Authoritative manifest contains 14 commands, including live and today; both new tests are in required gates.
- [x] Registration does not submit picks, change kill switches, mutate roles or execute delivery.
- [ ] Independent T2 review, merge, production registration and live acceptance pending.

## EVIDENCE:

```text
Focused tests: 11 tests, 11 pass, 0 fail.
Explicit strict TypeScript compilation: exit 0.
Focused ESLint: exit 0.
pnpm verify: static phases passed; live DB staging guard refused localhost.
[command-manifest] Verified 14 command definition(s).
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL.
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: discord-delivery
```

## Verification

- `pnpm type-check`: PASS, executed inside the successful static phase of `pnpm verify`.
- `pnpm test`: PASS, executed inside the successful static phase of `pnpm verify`.

- `pnpm exec tsx --test apps/discord-bot/scripts/deploy-commands.test.ts scripts/ci/deploy-discord-commands.test.ts`: PASS, 11/11.
- `pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --esModuleInterop --skipLibCheck apps/discord-bot/scripts/deploy-commands.ts apps/discord-bot/scripts/deploy-commands.test.ts scripts/ci/deploy-discord-commands.test.ts`: PASS.
- `pnpm exec eslint apps/discord-bot/scripts/deploy-commands.ts apps/discord-bot/scripts/deploy-commands.test.ts scripts/ci/deploy-discord-commands.test.ts`: PASS.
- `pnpm verify`: run; environment, lint, type-check, build, full `pnpm test`, Smart Form unit verification, command manifest and migration checks passed. The live `pnpm test:db` staging guard refused localhost. Full gate is not claimed green locally; approved staging CI must supply live DB proof. Smart Form browser E2E was not enabled.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, discord-delivery R1, no required artifact. R4 advisory QA covered by drift/failure tests.
- `git diff --check`: PASS.

## Runtime Verification

Production registration has not run. No production deployment, pick submission, switch or role change was performed. Unit tests are not live acceptance.

Read-only production baseline at 2026-10-01T20:04Z:

```text
Deployed SHA: cdca09a4ccc64d295b79474413139323c486e5fe
API / worker / Discord bot: healthy on that exact image tag
Application: 1418387196116861049
Guild: 1284478946171293736
Guild commands: stats, pick, leaderboard, help, recap
Global commands: []
official-picks killed: true
human-capper-recaps killed: true; recapStopped: true
Pending/processing official rows: 2, both pending, both picks voided
Official receipts: 2, latest 2026-09-18T23:37:46.580849+00:00
Official destination latest message: 1550652082896375962 (2026-09-18)
Member API: anonymous 401; bot 200; queued status refused 400
Registry writes: 0
```

Raw local read-only captures: .out/discord-wave1/utv2-1963-before-registry.json, utv2-1963-before-runtime.json, utv2-1963-before-recaps.json and utv2-1963-before-health.jsonl.

After approved deployment, capture deployed SHA/workflow results, full guild inventory and source comparison, unchanged global inventory, API/worker/bot health, killed official-picks, fail-closed recaps, pending-row classification and zero official message/receipt deltas. No watched pick.

Recovery: full replacement is idempotent. Failed read-back fails acceptance even if PUT succeeded. Diagnose and rerun the authorized deployment. Registry updates are external to container rollback; rollback acceptance must also register the rollback release manifest through the governed path.

## Execution provenance

Desktop session turn metadata reports gpt-6.1-sol at medium effort. Admission selected codex-sol-medium, which CLI policy resolves to gpt-5.6-sol. No CLI executor ran and no CLI success receipt is claimed. Actual desktop provenance is recorded truthfully. Sanctioned PM reconciliation of this narrow mismatch is required before binding/closeout; no routing-policy repair is proposed.

## Admission finding

CI Lane authority fails because runtime does not admit apps/discord-bot/scripts/deploy-commands.ts or its focused test. The delivery-ui lane admits those files but excludes .github/workflows/deploy.yml and package.json. The existing packet spans both. No allowlist was modified and no scope override was fabricated. PM must authorize a narrow admission correction or a split-lane plan before merge.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 2c56becfe8ff1be9dfbc2313c78d637962522bda
