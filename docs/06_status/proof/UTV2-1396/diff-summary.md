# UTV2-1396 diff summary

- Added one shared Command Center predicate for current (`metadata.testRun`) and legacy proof-fixture markers.
- Applied the predicate before Command Center performance, leaderboard, intelligence, queue, and exception aggregations.
- Excluded the same markers from API alert signal-quality metrics, while retaining fixtures in storage for auditability.
- Added regression coverage for marker recognition and alert metric exclusion.
