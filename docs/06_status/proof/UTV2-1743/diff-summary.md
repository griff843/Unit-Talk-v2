# UTV2-1743 Diff Summary

MERGE_SHA: 9cbf52cc0c562f2fdff9dfca32ba679da738d5fe

Issue: UTV2-1743
Tier: T2
Lane type: governance
Branch: claude/utv2-1743-parked-tier-c

## Implementation

| File | Change |
|---|---|
| `scripts/ops/merge-risk.ts` | Adds `executingLanesOnly()`, which excludes `parked` from the Tier C conflict calculation only. One call site changed; the other 11 uses of `activeLanesOnly` are untouched. |
| `scripts/ops/merge-risk.test.ts` | Five tests: parked vs executing, parked vs parked, two executing still hard-fail, resume-into-conflict refused, and preservation of branch/scope/proof references. |

## Substantive diff stat

```text
scripts/ops/merge-risk.test.ts | 69 ++++++++++++++++++++++++++++++++++++++++++
scripts/ops/merge-risk.ts      | 28 +++++++++++++++--
2 files changed, 95 insertions(+), 2 deletions(-)
```

## Scope notes

- No production runtime, deployment, ingestion, member delivery or database behaviour changed.
- The guard is not weakened: two executing Tier C lanes still hard-fail.
- No migration, contract, domain or worker file changed.
