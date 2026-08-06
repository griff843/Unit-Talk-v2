# UTV2-1619 diff summary — capability 17: truth-gated lifecycle completion

MERGE_SHA: d75679eb4ad172b48eb430a28f79809dd9d21940

- `lane-close.ts`: added `evaluateIssueCompletionEligibility` implementing the five
  completion conditions, and gated the Linear transition in
  `completeSuccessfulLaneClose` on all five holding.
- `lane-close.ts`: `SuccessfulLaneCloseResult` now carries `issue_completed` and the
  unsatisfied reasons, so a lane closing without completing its issue is a visible outcome.
- `lane-close.ts`: `completeAlreadyClosedLaneCleanup` explicitly reports
  `issue_completed: false` — a cleanup replay completes nothing.
- `linear-auto-close.yml`: the merge-triggered path now requires a terminal-successful
  manifest bound to this exact merge SHA with a passing receipt from a canonical runner
  against the same SHA; otherwise it withholds completion and states why.
- 9 tests added covering the three required preventions.

No production, runtime, migration, or delivery path is touched.
