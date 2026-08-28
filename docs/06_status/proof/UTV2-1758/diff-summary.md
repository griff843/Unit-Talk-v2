# UTV2-1758 — diff summary

MERGE_SHA: 1fdd7fc8133da12786466c5b733030aee8dcf841

## Files changed

| File | Purpose |
|---|---|
| `scripts/ops/orchestration-reconciler.ts` | Classification and authoritative in-flight manifest resolution. Adds `CheckClassification` and the four output buckets; adds `LinearLookupFailureKind` + `classifyLinearLookupError`; resolves an open PR's manifest from its exact head commit and prefers it over the main/working-tree copy; adds `ORCH-LINEAR-DELETED-ORPHAN`; re-derives verdict and exit code from the buckets; reports the four buckets in the human renderer. |
| `scripts/ops/orchestration-reconciler.test.ts` | 7 regression fixtures, each paired with a mutation that must flip its classification, plus a classifier table and a bucket-completeness assertion. Two pre-existing tests updated to the new contract (see below). |

## What changed, and why

### 1. In-flight manifests are read from the PR head

An in-flight lane's manifest correctly lives on its own branch until merge. The
reconciler resolved it only from `main` and the root working tree, so live lanes
read as having no manifest — and worse, a *stale untracked working-tree copy*
(`status: started`, `pr_url: null`) was preferred over the authoritative branch
manifest. `PullRequestSnapshot` now carries `head_sha` and `head_manifest`, and
that resolution is applied once and reused by every check that asks whether a
lane has an active manifest.

Suppression is driven strictly by *"a manifest was resolved at the PR head"* and
never by *"the PR is open"*. `head_manifest: null` means resolved-and-absent and
still fails; `undefined` means unresolved, which records an infra error and falls
back to the previous behaviour.

### 2. Linear lookup failures are classified by signature, not by luck

Classification previously depended on whether the issue happened to be in the
current working set, and matched a bare `not found`. Two consecutive runs at the
same commit classified UTV2-1432 as `ORCH-INFRA` and then as
`ORCH-HISTORICAL-DECAY`. `classifyLinearLookupError` now decides from the error
signature alone, in a fixed order: transient, then auth, then a specific
`entity not found`, then `unknown`. Anything not positively identified as a
deletion stays blocking.

### 3. Four buckets, and a narrowed exit rule

`dispatch_blocking_failures`, `closeout_debt`, `warnings`, `infra_errors`. Exit
is nonzero only for the first and last. Closeout debt is classified from lane
state — whether the lane still holds a lease, a manifest lock, or an active
Linear record — not from an identifier list.

## Deliberate behaviour changes to existing tests

Two pre-existing tests asserted the behaviour this lane exists to change. They
were updated rather than deleted, and still assert that the findings are
reported in full — only their dispatch authority moved:

- `all mode preserves strict historical reconciliation behavior` → renamed to
  `all mode still reports historical debt, but as non-blocking closeout debt
  (UTV2-1758)`. `ORCH-DONE-MERGE-SHA` still fails; it is now `closeout_debt` and
  the report exits 0.
- `human output separates required checks from cleanup candidates` → renamed to
  `human output separates the four reconciliation buckets`, asserting the new
  bucket labels and counts.

## Measured effect on live state

`pnpm ops:orchestration-reconcile --current --json`, same working set:

| | Before (`main` @ `b667c702`) | After |
|---|---|---|
| dispatch-blocking | 31 undifferentiated `fail` | 8 |
| closeout debt | not distinguished | 18 |
| warnings | not distinguished | 724 |
| infra errors | 1 (misclassified deletion) | 0 |
| `ORCH-OPEN-PR-MANIFEST-URL` | 7 | 2 |

UTV2-1729, 1736, 1744, and 1745 cleared. The 8 remaining blockers were each
checked and are genuine.

## Correction to the issue's own evidence

The issue lists UTV2-1652 as having a manifest "present on branch". It does not:
the manifest is absent at PR #1401's head `5c39f9ea`, while 676 sibling manifests
are present at that same head. UTV2-1652 therefore correctly still blocks. It was
not force-suppressed — this is the anti-regression control working on live data.

## Blast radius

Read-only governance tooling. No production, DB, migration, deployment,
ingestion, or delivery path is touched, and no genuinely blocking condition is
weakened.
