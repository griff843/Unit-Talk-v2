# PROOF: UTV2-1940

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-19T00:40:54.865Z
Issue: UTV2-1940
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1940-command-center-settlement-state-truth
PR URL: N/A
Head SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
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

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
