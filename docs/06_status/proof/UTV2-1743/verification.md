# PROOF: UTV2-1743

MERGE_SHA: 9cbf52cc0c562f2fdff9dfca32ba679da738d5fe

Verified source SHA: `9cbf52cc0c562f2fdff9dfca32ba679da738d5fe`

Production-unblocking lifecycle repair. `/dispatch` halted at Gate 1 and no
production lane could be admitted beside the active migration lane.

## ASSERTIONS:

- [x] `parked` lanes no longer count as Tier C contention.
- [x] The lock meaning of `parked` is unchanged — one call site altered, 11 left alone.
- [x] Two executing Tier C lanes still hard-fail.
- [x] Resuming a parked lane into a live Tier C conflict is refused.
- [x] Parked work, branches and proof references are preserved.
- [x] No production runtime, deployment, ingestion, delivery or database behaviour changed.

## EVIDENCE:

```text
verify:static: PASS (exit 0)
merge-risk suite: PASS (14 tests, 0 failed)
r-level check: PASS (5 changed files, no rules matched)
mutation: reverting the one call site fails 3 of 5 new tests
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ops/merge-risk.test.ts'` | PASS | 14 tests passed, 0 failed. |
| `pnpm verify:static` | PASS | Exit 0. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Verdict: PASS. 5 changed files. Rules matched: (none). |
| `pnpm test:db` | N/A | No runtime or database path is touched by this change. |

### Root cause

`ACTIVE_LOCK_STATUSES` (`scripts/ops/shared.ts:408`) contains `parked`, and the
Tier C conflict calculation filtered on that set. Preserved, non-executing work
therefore counted as live contention. Live evidence: `ops:substrate-guard`
returned 3 × `board_hard_fail:TIER_C_CONFLICT`, all involving an already-parked
lane with a closed unmerged PR and an unstaffed lane.

### Mutation testing

```text
revert executingLanesOnly -> activeLanesOnly:
  not ok  parked vs executing Tier C does not conflict
  not ok  two parked Tier C lanes do not conflict
  not ok  resuming a parked lane into a live Tier C conflict is refused
  # pass 11 / # fail 3
restored: # pass 14 / # fail 0
```

The two-executing-lanes hard fail passes either way. That is the intended
result: real concurrent Tier C work is still refused.

### Tier rationale

Recorded as **T2**, not T1, and stated explicitly rather than applied silently
because retiering changes who approves. The documented verification table
assigns T1 to work requiring `test:db` plus runtime proof; this change alters a
pure in-memory predicate with no runtime path, no database access, no
deployment, no migration and no customer-facing behaviour. It does touch a Tier
C *path*, which raises review scrutiny — but Tier C path sensitivity and tier
T1/T2/T3 are independent axes.

### Substantive diff stat

```text
scripts/ops/merge-risk.test.ts | 69 ++++++++++++++++++++++++++++++++++++++++++
scripts/ops/merge-risk.ts      | 28 +++++++++++++++--
2 files changed, 95 insertions(+), 2 deletions(-)
```
