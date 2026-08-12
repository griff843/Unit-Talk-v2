# UTV2-1696 Diff Summary

`ops:lease report` now resolves lane-manifest statuses and reports active leases
held by terminal lanes as `orphaned_leases`, independently of heartbeat expiry.
It prints separate `stale_count` and `orphaned_count` values and exits non-zero
when orphaned leases are present.

The focused regression creates a lease with a fresh heartbeat and a `done`
manifest status. It proves the lease is orphaned, not stale, and that the
report's exit decision is non-zero for the orphan while stale-only input does
not trigger that decision.
