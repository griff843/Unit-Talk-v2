# Diff summary: WORK-2026103001

Execution SHA: 8642030a7f112382a7ee6c9514b6069c8212120a

| File | Change |
|---|---|
| apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts | Test 3 (refused outsider) and test 4 (member-read fixture discovery) read `picks` by indexed `capper_id` instead of unindexed `selection`. `readPick` also selects `capper_id`, and tests 1 and 2 assert it equals CAPPER as a positive control. |

Not changed: production code (submit handler, member read, auth/allow-list), schema, data, timeouts and test skip conditions.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
