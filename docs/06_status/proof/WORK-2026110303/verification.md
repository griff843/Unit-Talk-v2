# PROOF: WORK-2026110303

MERGE_SHA: pending merge

Issue: WORK-2026110303
Tier: T2
Lane type: governance
result: local_pass

## ASSERTIONS:

- [x] A ruling recorded between attempts appears in attempt N+1's resume brief, which codex-exec builds from the closed checkpoint before `beginAttempt`. It appears under "### Orchestrator rulings — authoritative", ahead of the established findings, and is carried into the next attempt's plan and checkpoint (`a ruling recorded between attempts is stated as authoritative in attempt N+1`).
- [x] A ruling is refused while an attempt is in progress, and the checkpoint file is byte-identical afterwards (`a ruling is refused while an attempt is in progress and leaves the checkpoint untouched`).
- [x] Recording a ruling leaves completed phases, findings, pending actions, attempts, status and epoch unchanged, and advances `state_revision` by exactly 1 (`recording a ruling leaves phases, findings, pending actions and attempts intact`).
- [x] An `--answers` naming an unknown finding, empty text and a missing checkpoint are each refused (`a ruling naming an unknown finding, or with empty text, is refused`).
- [x] Rework archives rulings with the rejected epoch and carries them rebased: new `epoch_id`, `source_epoch_id` set to the old epoch. The rework brief lists them, and the rebased checkpoint still validates (`a rework epoch archives rulings with the rejected epoch and carries them rebased`).
- [x] A checkpoint written before this change, with no `orchestrator_rulings` field, still validates and renders no rulings section. `EXECUTION_CHECKPOINT_SCHEMA_VERSION` is unchanged (`a checkpoint written before rulings existed still validates and renders no rulings section`).
- [x] The `ruling` CLI exits 1 with `execution_checkpoint_ruling_refused` and records nothing when `UNIT_TALK_EXECUTION_EPOCH_ID` is set (the executor's attempt identity). Without it, the CLI records the ruling (`the ruling CLI refuses under an executor attempt identity and records without one`).

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

## Verification

Run on `46bd6da75c3df62011b91ed7aff362e512385b60`:

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

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1825
