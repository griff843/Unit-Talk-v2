# PROOF: WORK-2026110303

MERGE_SHA: 226decfb98239b01821c0a27063c2b2c679d6980

Issue: WORK-2026110303
Tier: T2
Lane type: governance
result: local static stage passed; live DB stage runs in CI only (local `pnpm verify` exit 1 at the staging guard)

## ASSERTIONS:

- [x] A ruling recorded between attempts appears in attempt N+1's resume brief, which codex-exec builds from the closed checkpoint before `beginAttempt`. It appears under "### Orchestrator rulings — authoritative", ahead of the established findings, and is carried into the next attempt's plan and checkpoint (`a ruling recorded between attempts is stated as authoritative in attempt N+1`).
- [x] A ruling is refused while an attempt is in progress, and the checkpoint file is byte-identical afterwards (`a ruling is refused while an attempt is in progress and leaves the checkpoint untouched`).
- [x] Recording a ruling leaves completed phases, findings, pending actions, attempts, status and epoch unchanged, and advances `state_revision` by exactly 1 (`recording a ruling leaves phases, findings, pending actions and attempts intact`).
- [x] An `--answers` naming an unknown finding, empty text and a missing checkpoint are each refused (`a ruling naming an unknown finding, or with empty text, is refused`).
- [x] Rework archives rulings with the rejected epoch and carries them rebased: new `epoch_id`, `source_epoch_id` set to the old epoch. The rework brief lists them, and the rebased checkpoint still validates (`a rework epoch archives rulings with the rejected epoch and carries them rebased`).
- [x] A checkpoint written before this change, with no `orchestrator_rulings` field, still validates and renders no rulings section. `EXECUTION_CHECKPOINT_SCHEMA_VERSION` is unchanged (`a checkpoint written before rulings existed still validates and renders no rulings section`).
- [x] The `ruling` CLI exits 1 with `execution_checkpoint_ruling_refused` and records nothing when `UNIT_TALK_EXECUTION_EPOCH_ID` is set (the executor's attempt identity). Without it, the CLI records the ruling (`the ruling CLI refuses under an executor attempt identity and records without one`).
- [x] PM review (pm-verdict/v1 CHANGES REQUIRED at `9f1ab22e9`): an executor identity can no longer delete rulings through `clear`. Under any attempt identity, current or stale, `clearCheckpoint` refuses with `execution_checkpoint_ruling_protected` and removes nothing when a closed checkpoint carries a ruling; both files stay byte-identical and the ruling is still readable. Without an identity, the orchestrator clear still removes both files (`an executor identity cannot clear a closed checkpoint that carries a ruling`).
- [x] The refusal also holds when the ruling survives only in the sidecar, or only in an archived prior epoch (`an executor clear is refused when only the sidecar or an archived epoch holds a ruling`).
- [x] State that cannot be parsed fails closed under an executor identity; ruling-free state still clears under one, so existing behavior is unchanged there (`an executor clear fails closed on state it cannot parse, and still clears ruling-free state`).
- [x] The `clear` CLI exits 1 with `execution_checkpoint_ruling_protected` under the current and under a stale `UNIT_TALK_EXECUTION_EPOCH_ID`, and clears without one (`the clear CLI refuses under an executor attempt identity when the checkpoint carries a ruling`).
- [x] No other deletion entrypoint exists. Every executor-identity write (`heartbeat`, `phase-complete`, `finding`, `pending`, finish) goes through `mutate`, which spreads the whole checkpoint and so keeps `orchestrator_rulings`. `beginAttempt` `fresh` refuses when readable state exists, and the CLI exposes no `begin` command. The remaining `fs.rmSync` calls remove only the mutation lock file.

## EVIDENCE:

Mutation checks. Each mutation was applied alone to `scripts/ops/execution-checkpoint.ts` with `perl -0pi`. After each one, `npx tsx --test scripts/ops/execution-checkpoint.test.ts` was run and the file was restored from a copy:

```text
M1-no-active-refusal: # fail 1 :: a ruling is refused while an attempt is in progress and leaves the checkpoint untouched|
M2-no-brief-render: # fail 1 :: a ruling recorded between attempts is stated as authoritative in attempt N+1|
M3-resume-drops: # fail 1 :: a ruling recorded between attempts is stated as authoritative in attempt N+1|
M4-rework-no-rebase: # fail 1 :: a rework epoch archives rulings with the rejected epoch and carries them rebased|
M5-no-answers-check: # fail 1 :: a ruling naming an unknown finding, or with empty text, is refused|
M6-no-cli-env-refusal: # fail 1 :: the ruling CLI refuses under an executor attempt identity and records without one|
M7-field-required: # fail 1 :: a checkpoint written before rulings existed still validates and renders no rulings section|
M8-ruling-resets-findings: # fail 1 :: recording a ruling leaves phases, findings, pending actions and attempts intact|
restored
```

What each mutation did:
- **M1:** disabled the in-progress refusal.
- **M2:** disabled brief rendering.
- **M3:** resume dropped rulings.
- **M4:** rework kept the old `epoch_id`.
- **M5:** disabled the `--answers` check.
- **M6:** disabled the CLI executor-identity refusal.
- **M7:** made the field mandatory in validation.
- **M8:** the ruling write cleared findings.

After restoring, `git hash-object scripts/ops/execution-checkpoint.ts` = `ca01692f85759c06173ddf74867b25f4fdc0a556`, which equals `git rev-parse HEAD:scripts/ops/execution-checkpoint.ts` at `46bd6da75c3df62011b91ed7aff362e512385b60`.

Clear-guard mutations on `5c927519c1e278148c1962c3edb5af253f7edbd9`. Each was applied alone with a scripted string replacement, `pnpm exec tsx --test scripts/ops/execution-checkpoint.test.ts` was run, and the file was restored from a copy:

```text
M1-no-guard -> # fail 4
M2-cli-no-identity -> # fail 1
M3-ignore-sidecar -> # fail 1
M4-ignore-archive -> # fail 1
M5-parse-fail-open -> # fail 1
M6-match-current-only -> # fail 4
M7-always-refuse-executor -> # fail 1
restored
```

What each mutation did:
- **M1:** removed the executor-identity guard from `clearCheckpoint`.
- **M2:** the `clear` CLI passed no identity.
- **M3:** the guard read only the primary file, not the sidecar.
- **M4:** the guard ignored rulings in archived epochs.
- **M5:** unparseable state was skipped instead of failing closed.
- **M6:** the guard applied only to the current epoch's identity, not a stale one.
- **M7:** every executor clear was refused, including ruling-free state.

After restoring, `git hash-object scripts/ops/execution-checkpoint.ts` = `bfbc116992c356a8adcbd0b33e1ada58f315303b`, which equals `git rev-parse 5c927519c:scripts/ops/execution-checkpoint.ts`.

## Verification

Corrected head. Run on `5c927519c1e278148c1962c3edb5af253f7edbd9`, the last non-proof commit:

- [x] `pnpm exec eslint scripts/ops/execution-checkpoint.ts scripts/ops/execution-checkpoint.test.ts`: exit 0.
- [x] `pnpm exec tsx --test scripts/ops/execution-checkpoint.test.ts`: `# tests 46`, `# pass 46`, `# fail 0`.
- [x] `pnpm exec tsx --test scripts/ops/codex-exec.test.ts`: `# tests 54`, `# pass 54`, `# fail 0`.
- [x] `pnpm type-check`: exit 0.
- [ ] `pnpm verify`: exit 1. Concrete blocker, not a pass. The entire static stage passed (lint, type-check, build, `pnpm test`, the app, domain, ops and local T1 proof suites, production post-migration tests and `verify:commands`). Summed over every suite it ran: `tests 8072`, `pass 8059`, `fail 0`, `skipped 13`, and no `not ok` line. Then `test:live-db` → `test:db` → `ci:assert-staging` refused before any database access: `[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` / `REFUSED: target identity could not be resolved from its URL`. This workstation is contained to a loopback placeholder, so the writable stage can only run in CI's `Writable DB proof (staging only)` job. The required `verify` check on the PR head is the authority for that stage.

Earlier run on `46bd6da75c3df62011b91ed7aff362e512385b60`:

- [x] `npx eslint scripts/ops/execution-checkpoint.ts scripts/ops/execution-checkpoint.test.ts scripts/ops/codex-exec.ts`: `eslint exit=0`.
- [x] `npx tsx --test scripts/ops/execution-checkpoint.test.ts`: `# tests 42`, `# pass 42`, `# fail 0`, `# skipped 0`.
- [x] `npx tsx --test scripts/ops/codex-exec.test.ts`: `# tests 54`, `# pass 54`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: `pnpm test exit=0`. The `# pass` and `# fail` lines summed across the run are `pass 7805` and `fail 0`.
- [x] `pnpm type-check`: exit 0.
  - That build (`tsc -b tsconfig.json`) references only `packages/*` and `apps/*`, not `scripts/`.
  - So the three changed files were also checked directly with `npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --types node`.
  - The only errors left are TS1470 (`import.meta` under the ad hoc module setting) and TS2307 (`@unit-talk/db/target-identity` path resolution). The same run reports both on files this lane does not modify (`scripts/ops/concurrency-config.ts`, `scripts/ops/execution-packet.ts`, `scripts/ci/required-db-smoke.ts`). No other error remains.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, `Rules matched: (none) — no R-level artifacts required for this diff`.
- [ ] `pnpm verify` was not run locally. The required `verify` CI check on the PR head is the authority for it.

## Runtime Verification

This lane has no database or production runtime surface. It changes the local execution-checkpoint file format and the Codex prompt only. The CLI path was exercised as a real subprocess (`tsx scripts/ops/execution-checkpoint.ts ruling ...`) in the CLI test above, against a temporary git repository and checkpoint directory.

## Merge SHA Binding

Merge SHA: `226decfb98239b01821c0a27063c2b2c679d6980`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1825
