# UTV2-1619 diff summary — capability 13: lifecycle capacity + resource release

MERGE_SHA: d2f371be10b9f82ba489e40139bc96f4c896e905

- `shared.ts`: added truthful terminal states `failed`, `superseded`, `cancelled` and a
  `parked` state, with transitions from every in-flight state and no direct path into
  `done`.
- `shared.ts`: replaced the single capacity set with a matrix —
  `TOTAL_CAPACITY_STATUSES`, `EXECUTOR_CAPACITY_STATUSES`, `TYPE_CAPACITY_STATUSES`,
  plus `TERMINAL_STATUSES` and `SUCCESS_TERMINAL_STATUSES`. `ACTIVE_LOCK_STATUSES` is
  retained unchanged in meaning for its three out-of-scope consumers.
- `concurrency-rules.ts`: executor caps now count only lanes an executor is actually
  working; total and type caps continue to count slot occupancy.
- `lease-registry.ts`: added `findLeasesHeldByTerminalLanes`, which reports leases still
  held by ended lanes and distinguishes completion from failure. Reports, never mutates.
- 11 tests added to existing wired suites (5 capacity, 6 lease).

No production, runtime, migration, workflow, or delivery path is touched.
