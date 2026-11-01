# PROOF: WORK-2026103006

MERGE_SHA: pending merge

Issue: WORK-2026103006
Tier: T1
Verified source: `ea13cf2b4db1662f772f2304d08c20043aa3cad7`
Result: static verification PASS; full local verify exits 1 at staging-identity guard; writable DB proof deferred to staging CI.

## Assertions

- Every requested unwired Discord destination (`official-picks`, `best-bets`, `trader-insights`, `exclusive-insights`, `foo`) returns `kill-switch-unwired`, logs the distinct event, never calls the adapter or claim methods, and leaves its row pending, unattempted and claimable.
- Synchronous throws and rejected reads return `kill-switch-read-error`, with no claim or adapter call.
- Canary without a repository and best-bets with an explicit released switch still deliver.
- Existing tests and assertions are preserved.

## Measured verification

- `pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts`: 95 passed, 0 failed (86 existing + 9 new).
- `pnpm exec tsx --test apps/worker/src/official-picks-exactly-once.test.ts`: 23 passed, 0 failed.
- `pnpm exec tsx --test --test-name-pattern='stale claim reaper|circuit state is restored' apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts`: 2 passed, 0 failed; synthetic proof only.
- Unfiltered restart/exactly-once invocation: 25 passed and 3 live-DB reads failed (`TypeError: fetch failed`). No live success claimed.
- `pnpm test:db`: refused unidentified `127.0.0.1` target. Packet recorded `host=unparseable`. Writable DB proof is blocked/deferred; required staging project is `xskgrzbteyqdufktjrjx`, through `staging-ci` and `CI_SUPABASE_*` credentials.
- `pnpm verify`: `pnpm verify:static` passed (lint, type-check, build, tests, migration and command checks). Totals: 8,012 tests; 7,999 passed, 13 skipped, zero failures. Full command exits 1 only when the subsequent staging guard refuses the unidentified local DB target. Earlier run caught the result-union helper signature, corrected before this source commit.
- Pre-merge evidence-bundle and model-routing contract validators: PASS.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; lifecycle-fsm matched. R4 remains PM-gated. The checker found existing WORK-2026100301 R2/R3/R4 artifact files; these are not claimed as new issue-specific runtime proof.

## Mutation

Temporarily removed the missing-repository refusal and restored the original `&& options.repositories.killSwitch` skip. Ran:

```sh
pnpm exec tsx --test --test-name-pattern='WORK-2026103006: unwired kill switch holds discord:official-picks pending' apps/worker/src/worker-runtime.test.ts
```

Exit 1: the named assertion observed `dead_letter` instead of `kill-switch-unwired` after reaching the unsafe claim path. Restored the fixed source; all 95 runner tests pass. Mutation log SHA-256: `c74c594c9a710b9ca34ab0c92700efa5d73e0adc06d5ec2d1f28628cd98a0cc0`.

The first isolated-copy mutation attempt failed module resolution and is excluded from mutation evidence. Only the actual assertion failure above is claimed.

## Pending authority

Exact-head CI, outer-wrapper execution truth/provenance, PM approval and governed merge remain pending. No child READY_FOR_REVIEW attestation is published. After authorized merge, the post-executor path runs lane-finalize and canonical orchestration reconciliation.

## Final local gate tail

```text
  type: 'test'
  ...
1..152
# tests 226
# suites 23
# pass 226
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2865.284628
smart-form e2e: not run (UNIT_TALK_SMART_FORM_E2E is not set).
Set UNIT_TALK_SMART_FORM_E2E=1 to run it. It requires a Playwright browser:
  pnpm exec playwright install chromium --with-deps
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026103006-worker-kill-switch-fail-closed/apps/discord-bot/command-manifest.json
[check-migration-versions] 139 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 138 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```
