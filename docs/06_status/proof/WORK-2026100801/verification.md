# PROOF: WORK-2026100801

MERGE_SHA: pending merge

Issue: WORK-2026100801<br>
Tier: T1<br>
Lane type: governance<br>
Execution SHA: `9f8f19029cd94696e3449f4d38634a7b68342fad`<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1725<br>
result: local_static_pass_staging_deferred

## Assertions

- [x] Native required-check workflows are read-only and preserve the required `pull_request`
      identities `Executor Result Validation` and `Merge Gate`.
- [x] The only write-capable retry job is loaded from default-branch-controlled triggers and never
      checks out or executes PR code, consumes artifacts, bootstraps dependencies, or fabricates a
      check result.
- [x] Retry selection binds workflow path, native event, repository, PR and exact head; newest
      incomplete evidence and live-head movement refuse instead of falling back.
- [x] Carry-forward activates only for a complete nonempty stale-head-only code vector. The trusted
      collector must return exact issue/head/original-approval identity and ordered C1-C7 passes.
- [x] Immediate pre-merge authorization recomputes the collector result and ignores posted receipt
      text or a previously green Merge Gate.
- [x] After collector execution, immediate pre-merge authorization re-reads branch-protection
      contexts, applies the normal exact-identity/latest-wins matcher, refreshes comments and
      labels, and performs the final live-head check. New, pending, failing or unreadable evidence,
      approval withdrawal, `t1-approved` removal, and `governance:pause` all refuse.
- [x] The retry broker binds the PR base to the API-advertised repository default branch and
      revalidates open state, repository, base and head adjacent to its only rerun mutation.
- [x] Hostile checkout, `git show`, curl/materialization, receipt forgery, withdrawal, failed checks,
      unsafe changes, malformed evidence and head-race regressions remain fail-closed.

## Evidence

Canonical authority:

- https://github.com/griff843/Unit-Talk-v2/pull/1724#issuecomment-6064048646
- https://github.com/griff843/Unit-Talk-v2/pull/1724#issuecomment-6064625158
- Historical recovery PR #1720 merged at `0ad7e1eb98dacb87c9b586f8e630290f2e2c9303`.

Measured privilege boundary at `origin/main` versus the execution SHA:

```text
origin/main executor-result-validator.yml: issue_comment + workflow_dispatch + actions: write
origin/main merge-gate.yml: workflow_dispatch + pull_request_review + issue_comment + actions: write
execution SHA native workflow actions:write grants: 0
execution SHA required-check-refresh.yml executable actions:write grants: 1
```

The computed carry-forward output is a separate `APPROVAL_CARRY_FORWARD_COMPUTED` notice plus a
canonical native job log/summary receipt containing the original verdict SHA/comment URL, successor
head, complete C1-C7 facts, admitted paths, main anchor, patch IDs, generating workflow-run URL and
the canonical “not an independent review” disclaimer. It is output-only; no receipt is read as
authority. A live output for this PR is pending post-executor PM approval and any qualifying
successor-head evaluation and is not claimed here.

The parent reproducers were rerun against the execution SHA:

```text
required checks become pending during collection: checkReads=2 authorized=false
same-repository PR targets non-default feature branch: reruns=[] refusal=targeting main
```

## Verification

- [x] `pnpm exec tsx --test 'scripts/ops/merge-gate-verdict.test.ts' 'scripts/ops/pre-merge-authorization.test.ts' 'scripts/ops/workflow-hardening.test.ts'`: 191 pass, 0 fail.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0.
- [x] `pnpm verify:static`: exit 0, including lint, type-check, build, full tests, Smart Form verify,
      command-manifest check and migration checks.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; 21 changed files;
      no R-level rules or artifacts required.
- [x] `pnpm ops:scope-diff -- --issue WORK-2026100801`: clean; all 5 rework implementation files
      are within declared scope.
- [ ] `pnpm test:db`: executed locally and refused before any write because the resolved target was
      `host=127.0.0.1 ref=unidentified`, not required staging ref `xskgrzbteyqdufktjrjx`.
- [ ] `pnpm verify`: executed on the linked review tree. `verify:static` completed successfully, then
      the writable DB phase exited 1 at the same local target-identity guard. Protected staging CI
      with `CI_SUPABASE_*` credentials must supply the required full-pass receipt.
- [ ] Protected exact-head CI/staging receipts and genuine executor result: pending PR publication
      and the authorized outer executor path.
- [ ] New binding PM merge approval and governed merge: explicitly post-executor; not claimed.

Local DB refusal (exit 1):

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

No deployment or production access was performed.

## Merge SHA Binding

Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1725<br>
Execution SHA: `9f8f19029cd94696e3449f4d38634a7b68342fad`
