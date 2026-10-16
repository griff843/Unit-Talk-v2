# PROOF: WORK-2026101603

MERGE_SHA: pending merge

Issue: WORK-2026101603
Tier: T1
Lane type: governance
result: local hook-compatibility change; no runtime, schema or database change, so no live-DB proof applies

## ASSERTIONS:

- [x] The hook accepts a staged evidence.json carrying either non-empty sha_binding.ci_sentinels (unchanged) or the canonical post-merge v2 binding that scripts/ops/proof-schema.ts defines.
- [x] Pre-merge (null merge_sha), non-hex or short merge_sha, missing or empty evidence_commit_sha, missing current_pr_head_sha, schema_version 1 with flat fields, a non-merge sha_type and an invalid verified_source_sha remain blocked.
- [x] Removing the acceptance clause turns the acceptance test red (mutation test).
- [x] No exemption, no hook disablement, no change to any proof content or CI gate.

## EVIDENCE:

Commands run in the lane worktree at source head `dec9bfc7b9a92f5ac9435c8a5103b32353db1f98`:

```
$ pnpm exec tsx --test scripts/ops/proof-check.test.ts
# tests 57  # pass 57  # fail 0

$ pnpm verify:static
exit 0 (14 command definitions; 139 migration versions, no duplicates; 138 migrations linted, no findings)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS   Changed files: 6   Rules matched: (none)

$ pnpm ops:scope-diff -- --issue WORK-2026101603
clean - all changes within declared scope
```

Exact-head CI: ci.yml run 38878744462, conclusion success on `dec9bfc7b9a92f5ac9435c8a5103b32353db1f98`.

## Verification

- The hook test suite passes with the three new tests; the required CI verify context passed on the PR head.
- No production migration, deployment, Discord mutation, provider activation, kill-switch change or delivery release was performed by this lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1764
