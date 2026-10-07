# PROOF: WORK-2026100603

MERGE_SHA: 8c09e756948eeaba69c0acfcb38543c42c4f62c1

Issue: WORK-2026100603
Tier: T1
result: pending_ci

## ASSERTIONS:

- [x] A real existing external JSON proof correction succeeds only when its exact path is present in frozen original scope and acceptance criteria and its parsed object changes structurally.
- [x] Same-epoch resume preserves the original baseline; a rejected rework epoch requires a new structural source or external-proof change from the rejected head.
- [x] Lane-owned proof, manifest, sync, model-routing, executor-result, checkpoint, `artifacts/**`, and frozen expected-proof outputs cannot self-corroborate as source even when explicitly assigned.
- [x] Cosmetic, invalid, scalar, array, new, deleted, and symlink evidence fails closed.
- [x] Missing immutable authority, non-ancestor baselines, zero diff, and incomplete implement/verify/closeout phase progression fail closed.
- [x] The executor packet ends at a verified draft review candidate; it does not claim PM approval, merge, lane finalization, reconciliation, or post-merge truth.
- [ ] Protected exact-HEAD `verify` and `Writable DB proof (staging only)` checks are green.
- [ ] The outer sanctioned executor wrapper has persisted a successful execution-truth verdict and provenance. This child proof does not publish `executor-result/v1 READY_FOR_REVIEW`.

## EVIDENCE:

The retained attempt-1 machine result is failed, with child exit 1 and no
fabricated completion:

```text
docs/06_status/proof/WORK-2026100603/executor-dd8-attempt-1-result.json
ok=false code=EXECUTION_FAILED codex_exit_code=1
epoch=dd8c1e84-1f63-4b5c-8729-684d46e7c0c9 phase=verify outcome=failed
```

Independent isolated Git/checkpoint fixtures against the current evaluator:

```text
assigned artifacts/r2-determinism-WORK-9990001.json only
IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE source_files_changed=0 evidence_artifacts_changed=0

rejected-head mutable scope/task-contract injection
REWORK_NO_SOURCE_CHANGE source_files_changed=0 evidence_artifacts_changed=0
```

The full fixture outputs are retained in
`independent-assigned-self-proof-fixed.json`,
`independent-rework-authority-fixed.json`, and
`independent-regression-review.md` in this proof directory.

## Verification

- `pnpm exec tsx --test 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-packet.test.ts'` — PASS, 156 tests, 0 failed.
- `pnpm verify:static` — PASS as the completed static stage of `pnpm verify`; lint, type-check, build, unit tests, production post-migration checks, Smart Form verification, and command/migration checks completed green.
- `pnpm verify` — expected non-zero at the live-DB stage after the complete static stage passed. The command did not pass overall and is not reported as a pass.
- `pnpm test:db` — REFUSED locally, exit 1: target identity resolved to `host=127.0.0.1 ref=unidentified`, while writable verification requires staging project `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; 19 changed files, no matching R-level artifact rules.
- Protected exact-HEAD T1 CI, including `verify` and `Writable DB proof (staging only)` — pending push of the final review-candidate commit.

This is truthful pre-merge evidence. PM approval, governed merge,
`ops:lane-finalize`, canonical reconciliation, and the downstream #1720
re-execution remain pending and are not implied by the completed static checks.

## Merge SHA Binding

Merge SHA: 8c09e756948eeaba69c0acfcb38543c42c4f62c1
PR: https://github.com/griff843/Unit-Talk-v2/pull/1721
Execution SHA: 7824a0263ffc6f42df6351acd557bc2c10a266d1

## Genuine outer executor completion

Sanctioned native Codex CLI 0.153.3, gpt-5.6-sol/high, epoch dd8c1e84-1f63-4b5c-8729-684d46e7c0c9 attempt 3: outer SUCCESS, actual child exit 0, wrapper exit 0, four source changes, zero evidence-only credits. All mandatory phases were genuinely completed by the native executor. Raw outer output and completed persisted checkpoint are retained alongside all failed history.

Implementation/current-main candidate 4d96f26ed99f12203676b7eb94767f0f9e246d3b passed GitHub CI run 37542056821: writable staging 9/9, T1 staging 152/152, downstream verify PASS. The outer wrapper then committed/pushed actual model provenance as eaf8fa140885fef3dae3adad8208f57df1c3dceb. This final evidence commit changes no executable code. Required CI must run again at the resulting exact HEAD before the outer reviewer publishes READY_FOR_REVIEW or requests normal binding PM merge approval. No success from an ancestor substitutes for final-HEAD required checks.
