# PROOF: UTV2-1873

MERGE_SHA: b60f20f9c3f89541e735c5cd22668bc238a8efa6

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-09T17:17:57.402Z
Issue: UTV2-1873
Tier: T3
Lane type: governance
Branch: claude/utv2-1873-hook-classify-before-allocate
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1550
Head SHA: 43ee02935b7df06ddc230e4e62bc486a23c119c5
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

Merge SHA: b60f20f9c3f89541e735c5cd22668bc238a8efa6
PR: https://github.com/griff843/Unit-Talk-v2/pull/1550
Approved PR head: 43ee02935b7df06ddc230e4e62bc486a23c119c5
Execution SHA: 43ee02935b7df06ddc230e4e62bc486a23c119c5
