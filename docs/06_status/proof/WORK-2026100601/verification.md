# PROOF: WORK-2026100601

MERGE_SHA: pending merge

Issue: WORK-2026100601
Tier: T1
Lane type: governance
Implementation SHA: d8b3bb85877d5ea823a17d76c7c4c917aec93eda
result: static_pass_live_db_deferred_to_staging_ci

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
# tests 139
# pass 139
# fail 0
# skipped 0
```

## Verification

- `pnpm type-check` — PASS as part of the final static chain.
- `pnpm test` — PASS as part of the final static chain, including all 139 focused recovery tests in `test:ops`.
- `pnpm verify:static` — PASS; DB-client boundary, sync/alignment, automation coverage, environment, lint, type-check, build, aggregate tests, production post-migration tests, Smart Form verification, command manifest, and migration checks completed successfully.
- `pnpm verify` — the complete static chain passed, then the writable DB phase correctly REFUSED before DB access because local host `127.0.0.1` is not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm test:db` — correctly REFUSED at the same pre-write staging identity guard. Writable DB and protected T1 verification are deferred to the `staging-ci` GitHub environment using `CI_SUPABASE_*` credentials.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS on implementation SHA; 10 changed files and no R-level rules matched.
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
