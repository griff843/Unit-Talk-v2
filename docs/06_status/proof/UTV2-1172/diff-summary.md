# UTV2-1172 Diff Summary

Issue: UTV2-1172 - Make branch discipline proof-aware without weakening issue binding
Branch: codex/utv2-1172-proof-aware-branch-discipline
Head: a0ad626549061b1e1fa991b4e78ec6183e0f644c

## Summary

UTV2-1172 makes branch-discipline issue extraction proof-aware without weakening binding for real PR references.

## Evidence

- `scripts/ops/branch-discipline-guard.ts`
  - Adds `normalizeProofOutputForIssueBinding()` to remove fenced blocks, marked proof/log/test sections, TAP output lines, and explicitly tagged proof/log lines from PR body issue extraction.
  - Keeps PR title, branch, commit messages, and normal body prose in the enforced issue-reference set.
  - Preserves fail-closed behavior for mismatched prose issue IDs.
- `scripts/ops/workflow-hardening.test.ts`
  - Covers proof/log sections that should be ignored.
  - Covers mismatched prose that must still fail branch discipline.

## Verification

- `tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
- `pnpm verify`
