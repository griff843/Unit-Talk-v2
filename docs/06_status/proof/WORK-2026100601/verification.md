# PROOF: WORK-2026100601

MERGE_SHA: pending merge

Issue: WORK-2026100601
Tier: T1
Lane type: governance
Implementation SHA: 6cf66a1af0494321e9a2e740d4cc17760147390f
result: static_pass_live_db_deferred_to_staging_ci

## Technical review rework resolved

The two previous actual executor epochs failed; their provenance remains recorded. The current rework epoch resolves the three parent-authored deterministic regressions in `scripts/ops/preflight.test.ts`:

1. Admission authority now requires a canonical whole-line recovery decision and rejects scoped denial/revocation, quoted or example prose, and a positive grant followed by revocation. The actual owner comment's `Ownership/readmission bridge: AUTHORIZED, narrowly` remains accepted without treating unrelated product restrictions as a denial.
2. Admission now requires actual G1/G2/G3/G4/G6/C6 PASS evidence and rejects every non-admitted or unknown failure. The original run's P6/P9/R1/R2 proof-schema failures remain the only admitted failures, and its existing C6 runtime proof is preserved.
3. This lane's schema-v2 evidence no longer carries the forbidden root `merge_sha`; the unchanged shared evidence contract passes without changing metrics or provenance.

Run `pnpm exec tsx --test scripts/ops/preflight.test.ts scripts/ops/lane-start.test.ts` FIRST to reproduce the review before another aggregate verification. Implement meaningful helper corrections within admitted scope. `.out/parent-recovery-review.ts` independently reproduces actual positive and negative live fixtures; do not call the negative fixtures production evidence.

For the sanctioned executor, checkpoint state lives in the ORDER checkout at `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026100601-order`, not this nested worktree. Use real `ops:exec-checkpoint` commands from that checkout to heartbeat and complete all five phases against the current epoch. Do not fabricate phase completion or start recursive executors. Run final `pnpm verify` once after final source changes and record the local staging guard refusal accurately. Parent will bind final external CI/staging after the wrapper commits model-routing metadata; do not idle waiting for those pre-metadata checks or claim they bind the new HEAD. Closeout phase may report external exact-HEAD CI and PM approval pending; lane remains in_review and draft until genuinely satisfied.

## ASSERTIONS:

- [x] Recovery is an explicit all-or-nothing request naming the source WORK, original PR, actual merge SHA, failed closeout run, and authority comment.
- [x] Preflight and lane-start each re-fetch GitHub evidence and `origin/main`; neither trusts a local source manifest for the admission decision.
- [x] The original PR must be merged to `main` from the source manifest branch, identify the source WORK, and have its merge SHA reachable from current `origin/main`.
- [x] The canonical closeout run must be an owner-dispatched failed `workflow_dispatch` on the merge SHA, and its logs must bind the same WORK/PR/SHA and show a fail-closed proof rejection.
- [x] Owner authority must be on the original PR, bind the same WORK/PR/SHA, explicitly authorize admission recovery, and postdate the failed run.
- [x] Only the exact attested source overlap is excepted. The source remains in concurrency accounting, and every unrelated overlap and unchanged gate remains enforced.
- [x] The recovery lane preserves the original relationship in a durable receipt and never overwrites the original lane's branch, PR, history, or proof.

## EVIDENCE:

Fresh live attestation on the implementation SHA returned `ok: true` for:

```text
source_issue_id: WORK-2026100501
source_branch: codex/work-2026100501-required-check-publication
source_manifest_status: in_review
original_pr_number: 1718
merge_sha: 9aef8ee772ea5a569f34619ad3089c1a51490c7d
failed_closeout_run_id: 37395130508
authority_comment_id: 6007640817
workflow_path: .github/workflows/post-merge-lane-close.yml
```

The deterministic regression suite measured:

```text
$ pnpm exec tsx --test 'scripts/ops/lane-start.test.ts' 'scripts/ops/preflight.test.ts'
# tests 143
# pass 143
# fail 0
# skipped 0
```

## Verification

- `pnpm type-check` — PASS as part of the final static chain.
- `pnpm test` — PASS as part of the final static chain, including all 143 focused recovery tests in `test:ops`.
- `pnpm verify:static` — PASS; DB-client boundary, sync/alignment, automation coverage, environment, lint, type-check, build, aggregate tests, production post-migration tests, Smart Form verification, command manifest, and migration checks completed successfully.
- `pnpm verify` — the complete static chain passed, then the writable DB phase correctly REFUSED before DB access because local host `127.0.0.1` is not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm test:db` — correctly REFUSED at the same pre-write staging identity guard. Writable DB and protected T1 verification are deferred to the `staging-ci` GitHub environment using `CI_SUPABASE_*` credentials.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS on implementation SHA; 12 changed files and no R-level rules matched.
- `FILE_SCOPE_PR_BRANCH=codex/work-2026100601-merged-lane-recovery pnpm exec tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --manifest-source git` — PASS; no scope conflicts or violations.
- `git diff --check` — PASS.

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Protected exact-HEAD CI/staging, the executor-generated `model-routing.json`,
genuine `pm-verdict/v1` approval, `t1-approved`, governed merge, and post-merge
closeout remain pending. The executor did not self-sign. Existing C6 runtime
proof was preserved and not regenerated.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1719
