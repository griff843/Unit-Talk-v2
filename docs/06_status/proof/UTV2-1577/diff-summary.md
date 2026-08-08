# Diff Summary: UTV2-1577

**Branch:** `claude/utv2-1577-autonomy-contracts-threat-model`
**Base:** `origin/main`
**Head:** `07d866a390fe5ca4d3b23aca03ffa728d888a457`

## Stat

```
 .ops/sync/UTV2-1577.yml                                       |  10 +
 docs/05_operations/autonomy/AUTHORITY_MATRIX.md                | 103 ++++++++++
 docs/05_operations/autonomy/COMPATIBILITY_MAP.md                |  52 +++++
 docs/05_operations/autonomy/CRASH_RESTART_SEMANTICS.md          | 122 ++++++++++++
 docs/05_operations/autonomy/KILL_SWITCH_CONTRACT.md             | 103 ++++++++++
 docs/05_operations/autonomy/LIMITS.md                           |  95 ++++++++++
 docs/05_operations/autonomy/MODE_CONTRACT.md                    | 118 ++++++++++++
 docs/05_operations/autonomy/NOTIFICATION_TAXONOMY.md            |  64 +++++++
 docs/05_operations/autonomy/PROGRAM_COMPLETION_DEFINITION.md    |  70 +++++++
 docs/05_operations/autonomy/PROMOTION_ROLLBACK_STANDARDS.md     |  87 +++++++++
 docs/05_operations/autonomy/README.md                           |  70 +++++++
 docs/05_operations/autonomy/STATE_MACHINE.md                    | 134 +++++++++++++
 docs/05_operations/autonomy/T1_QUEUE_BEHAVIOR.md                |  85 +++++++++
 docs/05_operations/autonomy/THREAT_MODEL.md                     | 211 +++++++++++++++++++++
 docs/05_operations/autonomy/schemas/audit_event_v1.schema.json  | 110 +++++++++++
 docs/05_operations/autonomy/schemas/autonomy_execution_state_v1.schema.json | 105 ++++++++++
 docs/05_operations/autonomy/schemas/dispatch_packet_v1.schema.json | 123 ++++++++++++
 docs/06_status/autonomy/STATUS.md                                |  34 ++++
 docs/06_status/lanes/UTV2-1577.json                              |  36 ++++
 docs/06_status/proof/UTV2-1577/.gitkeep                          |   0
 20 files changed, 1732 insertions(+)
```

(Plus this proof bundle's own 3 files -- `evidence.json`, `verification.md`, `diff-summary.md` -- added in
the closeout commit, not reflected in the stat above since it was captured before that commit.)

## File scope compliance

`file_scope_lock` for this lane is `["docs/05_operations/autonomy/**", "docs/06_status/autonomy/**"]`. All
17 substantive files above fall within those two paths. The remaining 3 entries
(`.ops/sync/UTV2-1577.yml`, `docs/06_status/lanes/UTV2-1577.json`, `docs/06_status/proof/UTV2-1577/.gitkeep`)
are the pre-existing lane-open commit (`997c4d0f`, already on this branch before this lane's implementation
work began) and this lane's own proof directory, per standard lane apparatus -- not new scope.

**No files outside these paths were touched.** In particular, the reserved paths for the concurrent
emergency-stabilization Codex lane were never read, written, or referenced:
`docs/06_status/lanes/UTV2-1571.json`, `docs/06_status/proof/UTV2-1571/**`,
`.github/workflows/post-merge-lane-close.yml`, `scripts/ops/lane-close.ts`, `scripts/ops/lane-close.test.ts`.

## Nature of the change

Pure documentation + JSON Schema. Zero lines of executable code (`scripts/**`, `apps/**`, `packages/**`)
touched. Zero workflow files (`.github/workflows/**`) touched. Zero changes to branch protection, required
status checks, `CONCURRENCY_CONFIG.json`, or `DELEGATION_POLICY.md`.

## New artifacts by deliverable

| # | Deliverable | File(s) |
|---|---|---|
| 1 | Canonical autonomy state machine | `STATE_MACHINE.md` |
| 2 | Authority matrix | `AUTHORITY_MATRIX.md` |
| 3 | Dispatch packet schema | `schemas/dispatch_packet_v1.schema.json` |
| 4 | Execution-state schema | `schemas/autonomy_execution_state_v1.schema.json` |
| 5 | Audit-event schema | `schemas/audit_event_v1.schema.json` |
| 6 | Owner kill-switch contract | `KILL_SWITCH_CONTRACT.md` |
| 7 | Mode contract | `MODE_CONTRACT.md` |
| 8 | Hard limits | `LIMITS.md` |
| 9 | Crash/restart semantics | `CRASH_RESTART_SEMANTICS.md` |
| 10 | T1 queue non-blocking guarantee | `T1_QUEUE_BEHAVIOR.md` |
| 11 | Threat model | `THREAT_MODEL.md` |
| 12 | Notification taxonomy | `NOTIFICATION_TAXONOMY.md` |
| 13 | Promotion/rollback standards | `PROMOTION_ROLLBACK_STANDARDS.md` |
| 14 | Program completion definition | `PROGRAM_COMPLETION_DEFINITION.md` |
| 15 | Compatibility map | `COMPATIBILITY_MAP.md` |
| — | Contract-set index | `README.md` |
| — | Program status/index view | `docs/06_status/autonomy/STATUS.md` |

## Verification

See `verification.md` in this same directory for the full `pnpm verify` and `r-level-check` results.
