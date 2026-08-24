# UTV2-1737 Diff Summary

MERGE_SHA: N/A

Issue: UTV2-1737
Tier: T1
Lane type: governance
Branch: claude/utv2-1737-clean

## Authored here (469 insertions, 11 deletions, 6 files)

| File | Change |
|---|---|
| `scripts/ops/execution-packet.ts` | `PREAMBLE_KEY` sentinel + capture of pre-heading description content; `TaskContractError` class and `unmapped_sections` validation producing structured refusal for stale contracts. |

## Inherited from preserved head 0f5a533d (1,118 insertions, 8 files)

`execution-packet.ts`, `codex-exec.ts`, `claude-exec.ts`, `lane-start.ts` and
their tests. **Not re-derived** — rebased onto current main and submitted for
review as part of the complete diff.

## Scope notes

- No production runtime, deployment, ingestion, member delivery or database behaviour changes.
- Dry-run proven pure: no executor, no lease/manifest/Linear mutation.
- One list-formatting improvement was written and reverted as out-of-contract.
