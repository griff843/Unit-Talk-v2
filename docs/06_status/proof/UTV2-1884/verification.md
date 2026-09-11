# PROOF: UTV2-1884

MERGE_SHA: 3063a077240a4275fc4b1890513280f76dc19202

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-11T12:10:28.039Z
Issue: UTV2-1884
Tier: T3
Lane type: governance
Branch: claude/utv2-1884-file-scope-parent-existence
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1563
Head SHA: 9bf0caa113f44773ef665527d94044772e8fbc6c
result: not_run

## ASSERTIONS:

- [ ] Replace with the acceptance criteria this lane claims to satisfy, one per line.
- [ ] Every box left unchecked is an unmet criterion, not a formatting placeholder.

## EVIDENCE:

The measured commands are recorded below. Replace the block with real output
when the commands are executed; a fenced block is required and must not be empty.

```
$ pnpm type-check
$ pnpm test
$ pnpm verify
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
(not run by proof-generate)
```

## Verification
- [ ] `pnpm type-check`: not run by proof-generate
- [ ] `pnpm test`: not run by proof-generate
- [ ] `pnpm verify`: not run by proof-generate
- [ ] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: not run by proof-generate

## Runtime Verification
- Generated foundation artifact. Replace or append command output when runtime proof is executed.

## Merge SHA Binding

Merge SHA: 3063a077240a4275fc4b1890513280f76dc19202
PR: https://github.com/griff843/Unit-Talk-v2/pull/1563
Approved PR head: 9bf0caa113f44773ef665527d94044772e8fbc6c
Execution SHA: 9bf0caa113f44773ef665527d94044772e8fbc6c
