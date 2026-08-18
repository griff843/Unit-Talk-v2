# PROOF: UTV2-1722

MERGE_SHA: 8762836ba710b9b8c08cac4549935174f735e9fe

ASSERTIONS:

- [x] Migration and static profiles are not harvested as app-runtime evidence, and unknown profiles fail closed.
- [x] Schema-v2 proof generation never authors `verifier.identity`.
- [x] A failed post-merge closeout cannot durably persist proof binding changes.
- [x] The trusted closeout keeps the merge mutex through one guarded push; a rejection never rebases or retries and the exact lock is released afterward.
- [x] Legacy schema-v1 governance bundles retain additive DB-proof harvesting.
- [x] Post-merge attestation fetches the immutable PR-head ref when the original head is absent locally.
- [x] P10/R3 accepts an original PR-head receipt after merge only through an authentic merged-PR attestation.
- [x] The damaged historical migration evidence is byte-identical to its authoritative source blob.
- [x] The required writable DB proof passed in exact-head staging CI.

EVIDENCE:

```text
static gate: PASS
focused regressions: PASS (509 tests, 0 failed, 0 skipped)
writable DB: PASS (CI run 32126797482, job 95679040123, head ecd42d20a3ba8d547f078f8b7617cf5498a4ea2a)
historical restoration: PASS (source and restored blob 426c5898e6ae50de0611fc79cd458295b91a9d1c)
```

## Verification

Substantive source binding: `8762836ba710b9b8c08cac4549935174f735e9fe`.

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
1..491
# tests 509
# suites 3
# pass 509
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3644.470974
```

### Writable DB proof

Authoritative staging CI receipt:

```text
result: PASS
run: 32126797482
job: 95679040123 (Writable DB proof (staging only))
head: ecd42d20a3ba8d547f078f8b7617cf5498a4ea2a
run URL: https://github.com/griff843/Unit-Talk-v2/actions/runs/32126797482
job URL: https://github.com/griff843/Unit-Talk-v2/actions/runs/32126797482/job/95679040123
```

`gh run view 32126797482` and `gh api repos/griff843/Unit-Talk-v2/actions/jobs/95679040123` both report `conclusion: success`; the credentialed job completed both `Run writable DB proof against staging` and `Run the T1 live proof suites against staging` successfully.

The local `pnpm test:db` attempt remains recorded only as proof that the workstation guard refused the unidentified containment target before tests ran:

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

Because the local staging guard exits before `tsx --test` starts, that local attempt has no legitimate live-DB TAP trailer. No local passing result is fabricated; the successful CI receipt above is the required writable-DB evidence.

### Correction addendum

At substantive head `8762836ba710b9b8c08cac4549935174f735e9fe`, trusted post-merge `ops:lane-close` retains the merge mutex after the gate passes and through the persistence attempt. The workflow performs one push against that evaluated state; any rejection emits the named `post-merge-lane-close guarded push rejected` error and exits without rebasing or retrying, after which an `always()` cleanup releases the exact issue/branch mutex. The flag is rejected outside the exact trusted workflow context, ordinary lane-close behavior still releases on success, and terminal cleanup replay also preserves the mutex until workflow cleanup. Behavioral spawnSync coverage proves push-before-release ordering, single-attempt persistence, no rebase on rejection, and release after both outcomes. The same correction set preserves schema-v1 governance harvesting and fetches `refs/pull/<n>/head` when an attested PR head is missing locally. The obsolete `.gitkeep` remains removed.

### R-level compliance

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:

```text
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
```
