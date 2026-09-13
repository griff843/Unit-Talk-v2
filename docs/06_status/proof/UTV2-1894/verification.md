# PROOF: UTV2-1894

MERGE_SHA: 15ee3a505de88c8c0494ad1430b3b3a997122627

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-13T13:40:30.948Z
Issue: UTV2-1894
Tier: T3
Lane type: governance
Branch: claude/utv2-1894-deploy-packet
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1572
Head SHA: 14ac6567f825285b736221e79a789800ca0b37e0
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

Merge SHA: 15ee3a505de88c8c0494ad1430b3b3a997122627
PR: https://github.com/griff843/Unit-Talk-v2/pull/1572
Approved PR head: 14ac6567f825285b736221e79a789800ca0b37e0
Execution SHA: 14ac6567f825285b736221e79a789800ca0b37e0
