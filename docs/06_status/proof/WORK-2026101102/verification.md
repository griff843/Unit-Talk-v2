# PROOF: WORK-2026101102

MERGE_SHA: pending merge

Issue: WORK-2026101102
Tier: T1
result: governance CI guard amendment; no runtime, schema or database change, so no live-DB proof applies

## ASSERTIONS:

- [x] The exact NCAAF migration `supabase/migrations/20261010170000_ncaaf_participant_catalog.sql` paired with `packages/db/src/canonical-reference-schema.test.ts` no longer requires further proof.
- [x] An unrelated migration with the canonical-reference test still fails; a second migration alongside the NCAAF pairing still fails; a sensitive runtime file with the test still fails.
- [x] Existing accepted live-proof paths still pass, and the accepted proof pattern list is unchanged (no generic `packages/db` test glob, no caller-supplied exemption).
- [x] The guard's advisory status, branch protection and the `skip-proof-coverage` label are untouched.

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/ci/proof-coverage-guard.test.ts
# tests 8
# pass 8
# fail 0

mutation A (exemption removed): not ok 1 - recognized NCAAF migration paired with the canonical-reference test passes
mutation B (exemption widened to any migration): not ok 3, not ok 4, not ok 7

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm ops:preflight WORK-2026101102 --tier T1 --lane-type governance --executor claude --refresh
VERDICT: PASS (42 checks)
```

## Verification

- `pnpm type-check` and `pnpm test` are exercised by the required CI `verify` context, which runs `pnpm verify` (env:check + lint + type-check + build + test); the new test is registered in `test:ops` and so runs under `pnpm test`.
- `r-level-check` passed locally and in CI, as above.
- The test executes the actual `run:` bodies of the workflow's "Check for sensitive runtime changes" and "Check for corresponding live-DB proof changes" steps in bash against synthetic change sets; no database access or write is part of this lane.
- No production migration application, deployment, participant production write, Discord mutation, provider activation, Capitals change or delivery release.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1737

## Rebind note

Head 1779bdbf failed the UTV2-1949 temp-workspace guard in `pnpm test` (raw mkdtemp with no release in scope). The test now uses createTempWorkspace/releaseTempWorkspace. Re-run locally: proof-coverage-guard.test.ts and temp-workspace-cleanup-guard.test.ts, 16/16 pass; eslint clean. Proof re-anchored to 1e344e0e4bb02e8eb197712c4e994a10452ad0a2, the last non-proof commit. No workflow, migration, roster or runtime file changed by this rebind.

## Resync note

Resynced onto main (faef4df40) via ops:merge-wrapper pr-update-branch; the merge commit 1e344e0e4bb02e8eb197712c4e994a10452ad0a2 brought in only other lanes' files. The guard workflow, REQUIRED_CI_CHECKS.md, the regression test and package.json are byte-identical to the prior head. Proof re-anchored to the merge commit.

## Second resync note

Resynced again onto main (9aa369921, readiness-ledger refresh only) via ops:merge-wrapper pr-update-branch; merge commit 1e344e0e4bb02e8eb197712c4e994a10452ad0a2 changed only docs/06_status/readiness/readiness-score.json. Guard workflow, test, docs and package.json are byte-identical. Proof re-anchored to the merge commit.
