# PROOF: UTV2-1863

MERGE_SHA: d48e46f41ae89f8fa46a7c4237e0d4066635be9b

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-09T07:55:59.640Z
Issue: UTV2-1863
Tier: T3
Lane type: governance
Branch: claude/utv2-1863-lease-reclaim-terminality
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1542
Head SHA: d3d004332130de19ef52a7ec662c4d6cfb3bef1d
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

Merge SHA: d48e46f41ae89f8fa46a7c4237e0d4066635be9b
PR: https://github.com/griff843/Unit-Talk-v2/pull/1542
Approved PR head: d3d004332130de19ef52a7ec662c4d6cfb3bef1d
Execution SHA: d3d004332130de19ef52a7ec662c4d6cfb3bef1d
