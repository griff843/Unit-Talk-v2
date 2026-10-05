# PROOF: WORK-2026100501

MERGE_SHA: pending merge

Issue: WORK-2026100501
Tier: T1
Lane type: governance
Implementation SHA: 0b87cd9b1288351ad90954dd0c2cc5c0ced642f5
result: static_pass_live_db_deferred_to_staging_ci

## ASSERTIONS:

- [x] `Executor Result Validation` and `Merge Gate` are genuine native jobs only on eligible `pull_request` runs.
- [x] Result/approval comments, reviews, and default-branch manual recovery can only request a rerun of the newest exact-workflow, exact-PR, exact-HEAD eligible run.
- [x] Missing evidence, stale HEAD, unavailable newest targets, policy denial, and evaluator errors fail closed; recovery never selects an older run.
- [x] Non-PR skipped jobs carry distinct ineligible-event names and cannot satisfy either protected context.
- [x] Native policy jobs are read-only and execute trusted base code; only refresh jobs receive `actions: write`, with no checks write permission.
- [x] Existing tier policy, `pm-verdict/v1`, exact-HEAD T1 approval, `t1-approved`, proof identity, and exact-HEAD CI checks remain enforced.
- [x] PR #1715 existence-based settlement behavior was not changed; the correction-chain concern was measured separately with the dedicated read-only shadow reader.

## EVIDENCE:

Root cause and authenticated API identifiers are recorded in `publication-root-cause.md`. The separate production observation is recorded in `superseded-settlement-observation.json`: 8,313 candidate links read, 1,412 canonical qualifying links to 1,182 qualifying picks, and zero concern picks/candidates. It is not a replacement settlement metric and performed no mutation, RPC, grant, or secret change.

Focused deterministic coverage on the final implementation:

```text
$ pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts scripts/ops/merge-gate-verdict.test.ts scripts/ops/workflow-hardening.test.ts
# tests 148
# pass 148
# fail 0
# skipped 0
```

## Verification

- `pnpm type-check` — PASS.
- `pnpm test` — PASS; aggregate repository suite completed with zero failures.
- `pnpm verify:static` — PASS; DB-client boundary, sync/alignment, automation coverage, environment, lint, type-check, build, aggregate tests, production-post-migration tests, Smart Form verification, command manifest, and migration checks passed.
- `pnpm verify` — the complete static chain passed, then the writable DB phase correctly REFUSED before DB access because local host `127.0.0.1` is not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm test:db` — correctly REFUSED at the same pre-write containment guard. Exact-HEAD writable proof is deferred to the protected `staging-ci` GitHub environment using `CI_SUPABASE_*` credentials.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS on implementation SHA; 15 changed files, no R-level rules matched.
- `FILE_SCOPE_PR_BRANCH=codex/work-2026100501-required-check-publication pnpm exec tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --manifest-source git` — PASS; no scope conflicts or violations.
- `git diff --check` — PASS.

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Required pre-merge receipts still pending external GitHub execution: final exact-HEAD `verify`, writable staging/T1 CI, native protected-context eligibility, immutable PM approval, and governed merge.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1718
