# Diff Summary — UTV2-1310 G-CONST-15 Canonical Gap Map

**Lane:** UTV2-1310  
**Branch:** `claude/utv2-1310-g-const-15-canonical-gap-map`  
**Tier:** T2  
**Merge SHA:** (pending — pre-merge)

---

## Files Created

### `docs/06_status/gap-map/canonical-gap-map.json`
Machine-readable canonical gap map. Contains:
- `total_open_issues`: 27 open issues (non-Done, non-Cancelled, non-Deferred)
- `duplicate_groups`: 3 groups identified (readiness audit v3 dual-issue, edge certification chain, CLV sequential waves)
- `stale_issues`: 9 issues with 10+ days no update and no active progress
- `constitutional_gaps`: 6 G-CONST or constitutional gap issues still open
- `dispatch_ready`: 7 issues ready for immediate dispatch
- `frozen_backlog`: 9 issues intentionally future-stage-gated or PM-frozen

### `docs/06_status/gap-map/dedup-recommendations.md`
Human-readable markdown summary for PM review. Contains:
- Open issue count by state (27 total across 5 states)
- G-CONST gap status table (G-CONST-9 through G-CONST-17; 4 open)
- Duplicate/overlap analysis with action recommendations
- Ranked top 6 dispatch candidates

### `docs/06_status/proof/UTV2-1310/diff-summary.md`
This file.

### `docs/06_status/proof/UTV2-1310/verification.md`
Verification evidence: type-check, test TAP, test:db TAP, r-level check.

---

## What This Lane Produced

- Read-only Linear scan of all open issues across all states
- Identified 4 open G-CONST gaps (G-CONST-14, 15, 16, 17)
- Identified 0 true duplicate issues requiring cancel/merge (3 near-overlap groups with dispatch ordering recommendations)
- Identified top 7 dispatch candidates
- Identified 9 frozen/future-gated issues that should not be dispatched
- Produced machine-readable JSON for use by automated dispatch loops

## No-Mutation Confirmation

No Linear issues were created, updated, or cancelled during this lane. All output is read-only analysis.
