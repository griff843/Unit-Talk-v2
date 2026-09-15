# PROOF: UTV2-1874

MERGE_SHA: 2b58117a25e0c050663e96bf86f06f656c43b49b

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-09T17:48:47.228Z
Issue: UTV2-1874
Tier: T3
Lane type: governance
Branch: claude/utv2-1874-review-packet-proof-scope
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1551
Head SHA: f1e77124b1ac4e9bca05a6d0213354dd2249e03d
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

Merge SHA: 2b58117a25e0c050663e96bf86f06f656c43b49b
PR: https://github.com/griff843/Unit-Talk-v2/pull/1551
Approved PR head: f1e77124b1ac4e9bca05a6d0213354dd2249e03d
Execution SHA: f1e77124b1ac4e9bca05a6d0213354dd2249e03d
