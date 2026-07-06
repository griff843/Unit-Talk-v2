# Diff Summary — UTV2-1475

Issue: UTV2-1475
Tier: T2
Branch: claude/utv2-1475-fix-l3-linear-state-check
Head SHA: 16e38dd9de45165ff4ac8954a11dec20db95f987
MERGE_SHA: acb6324ccab878997736dd3bca0c8a722c5c8ec4

## Files changed

- `scripts/ops/truth-check-lib.ts` — extracted the L3 permitted-state check into an
  exported pure function `isLinearStatePermittedForL3`, backed by a
  `L3_PERMITTED_LINEAR_STATES` set. Replaced the stale `'In Review'` reference
  (a state this Linear workspace does not have) with the actual workspace
  PM-review state `'In PM Review'`. `'Done'` continues to be accepted.
- `scripts/ops/truth-check-lib.test.ts` — added 5 regression tests covering the
  new function: accepts `In PM Review`, accepts `Done`, rejects the stale
  `In Review` string, rejects unrelated workflow states (Backlog, Blocked,
  Cancelled, Abandoned, Todo, In Progress), and rejects empty/undefined state.

## Why

`ops:lane-close --repair-merged` runs `runTruthCheck`, which gates L3 on Linear
state. This workspace's actual PM-review state is `In PM Review`
(confirmed via `Linear.get_issue` on UTV2-1473's `stateHistory`), not
`In Review`. The stale reference made repair-merged closeout for
UTV2-1365 impossible without either bypassing truth-check or manually
transitioning Linear to Done — both of which were explicitly forbidden for
this lane.

## Scope discipline

No other L-checks, C-checks, or Linear workflow states were touched. No
broad/fuzzy state matching was added — the permitted-state set is an exact
2-entry allowlist (`In PM Review`, `Done`).
