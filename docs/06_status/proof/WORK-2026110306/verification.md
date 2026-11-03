# PROOF: WORK-2026110306

MERGE_SHA: 31fa4aaaad5f3e363175b90aad10349969c64b55

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-11-03T18:15:33.341Z
Issue: WORK-2026110306
Tier: T3
Lane type: governance
Branch: claude/work-2026110306-bind-0301-diff-summary
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1827
Head SHA: 432a7ae45290db076e26f4f930700ba4e3b8ecda
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

Merge SHA: 31fa4aaaad5f3e363175b90aad10349969c64b55
PR: https://github.com/griff843/Unit-Talk-v2/pull/1827
Approved PR head: 432a7ae45290db076e26f4f930700ba4e3b8ecda
Execution SHA: 432a7ae45290db076e26f4f930700ba4e3b8ecda
