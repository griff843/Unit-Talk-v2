# PROOF: UTV2-1955

MERGE_SHA: a172b71b60b4eb2351b6d78fc03df6397362ac21

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-27T08:43:58.153Z
Issue: UTV2-1955
Tier: T3
Lane type: governance
Branch: claude/utv2-1955-closeout-proof-repair
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1664
Head SHA: f21584cc9931aa46682541a6d3cd6d8c89413ecf
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

Merge SHA: a172b71b60b4eb2351b6d78fc03df6397362ac21
PR: https://github.com/griff843/Unit-Talk-v2/pull/1664
Approved PR head: f21584cc9931aa46682541a6d3cd6d8c89413ecf
Execution SHA: f21584cc9931aa46682541a6d3cd6d8c89413ecf
