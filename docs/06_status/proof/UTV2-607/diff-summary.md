# UTV2-607 Diff Summary

Implemented persistent worker circuit-breaker recovery:

- Worker startup now rehydrates running `worker.circuit-open` rows from `system_runs`.
- Restored open circuits block delivery after worker restart until cooldown expires.
- Expired persisted circuit rows are completed before the worker probes the target again.
- Duplicate running circuit rows are closed so operator health does not stay degraded from stale state.
- Added worker runtime tests for restored open state and expired persisted circuit recovery.
