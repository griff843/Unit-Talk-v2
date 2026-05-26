UTV2-1172 makes branch-discipline issue extraction proof-aware without weakening binding for real PR references.

Changed files:
- `scripts/ops/branch-discipline-guard.ts`
- `scripts/ops/workflow-hardening.test.ts`

Implementation:
- Added `normalizeProofOutputForIssueBinding()` to remove fenced blocks, marked proof/log/test sections, TAP output lines, and explicitly tagged proof/log lines from PR body issue extraction.
- Kept PR title, branch, commit messages, and normal body prose in the enforced issue-reference set.
- Preserved fail-closed behavior for mismatched prose issue IDs.

Verification:
- `tsx --test scripts/ops/workflow-hardening.test.ts` passed.
- `pnpm type-check` passed.
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed with no matched R-level rules.
- `pnpm verify` passed.
