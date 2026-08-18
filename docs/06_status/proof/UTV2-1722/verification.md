# PROOF: UTV2-1722

MERGE_SHA: dd68cda490b9c64c74a45c6b4336d0371e92c26a

ASSERTIONS:

- [x] Migration and static profiles are not harvested as app-runtime evidence, and unknown profiles fail closed.
- [x] Schema-v2 proof generation never authors `verifier.identity`.
- [x] A failed post-merge closeout cannot durably persist proof binding changes.
- [x] P10/R3 accepts an original PR-head receipt after merge only through an authentic merged-PR attestation.
- [x] The damaged historical migration evidence is byte-identical to its authoritative source blob.

EVIDENCE:

```text
static gate: PASS
focused regressions: PASS (505 tests, 0 failed, 0 skipped)
writable DB: BLOCKED_DEFERRED locally by staging target identity guard
historical restoration: PASS (source and restored blob 426c5898e6ae50de0611fc79cd458295b91a9d1c)
```

## Verification

Substantive source binding: `dd68cda490b9c64c74a45c6b4336d0371e92c26a`.

### Static gate

`pnpm verify:static` passed in full, including environment checks, lint, `pnpm type-check`, build, `pnpm test`, smart-form verification, and command verification.

The final output was:

```text
> @unit-talk/v2@0.1.0 verify:commands
> pnpm --filter @unit-talk/discord-bot command-manifest:check && node scripts/check-migration-versions.mjs && node scripts/lint-migrations.mjs

> @unit-talk/discord-bot@0.1.0 command-manifest:check
> tsx scripts/sync-command-manifest.ts --check

[command-manifest] Verified 14 command definition(s) against apps/discord-bot/command-manifest.json
[check-migration-versions] 7 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 6 migration file(s) checked — no findings.
```

### Focused issue regressions

Command:

```text
pnpm exec tsx --test 'scripts/ops/ci-db-proof-harvest.test.ts' 'scripts/ops/lane-close.test.ts' 'scripts/ops/proof-generate.test.ts' 'scripts/ops/proof-schema.test.ts' 'scripts/ops/truth-check-lib.test.ts' 'scripts/ops/workflow-hardening.test.ts'
```

Literal TAP trailer:

```text
1..487
# tests 505
# suites 3
# pass 505
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3439.850106
```

### Writable DB proof

Command: `pnpm test:db`

Literal output:

```text
> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1722-closeout-recovery
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts

> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1722-closeout-recovery
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
```

Because the staging guard exits before `tsx --test` starts, this run has no legitimate live-DB TAP trailer. A passing live-DB result is not fabricated.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

### R-level compliance

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:

```text
Verdict: PASS
Changed files: 17
Rules matched: (none) — no R-level artifacts required for this diff
```
