# PROOF: UTV2-1529

MERGE_SHA: e09b3cae378d2a7ad12bb09b1f2c6c339778ddc0

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-07T20:22:11.925Z
Issue: UTV2-1529
Tier: T3
Lane type: governance
Branch: claude/utv2-1529-truth-check-scope-override
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1532
Head SHA: 26ea9a8381d7581577008ec28d7128527072cf98
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

Merge SHA: e09b3cae378d2a7ad12bb09b1f2c6c339778ddc0
PR: https://github.com/griff843/Unit-Talk-v2/pull/1532
Approved PR head: 26ea9a8381d7581577008ec28d7128527072cf98
Execution SHA: 26ea9a8381d7581577008ec28d7128527072cf98
