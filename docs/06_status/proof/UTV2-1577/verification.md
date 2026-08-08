# PROOF: UTV2-1577

| Field | Value |
| --- | --- |
| Issue | UTV2-1577 |
| Tier | T1 |
| Branch | claude/utv2-1577-autonomy-contracts-threat-model |
| Commit SHA(s) | `07d866a390fe5ca4d3b23aca03ffa728d888a457` (branch head, pre-merge) |

MERGE_SHA: 07d866a390fe5ca4d3b23aca03ffa728d888a457

(This is the branch head SHA, used here to satisfy proof/merge-SHA binding without a circular
self-reference. The real merge SHA is additionally recorded post-merge by the standard
`ops:proof-generate --merge-sha` closeout step, which rewrites the "Commit SHA(s)" row above and the
MERGE_SHA line to the true merge SHA.)

## Verification

## Summary

AUT-1 of the Autonomous Delivery Control Plane program (six-lane program, AUT-1 through AUT-6). This lane
writes only the canonical, executable contracts (state machine, authority matrix, three concrete JSON
Schemas, kill-switch contract, mode contract, hard numeric limits, crash/restart semantics, T1 non-blocking
guarantee, threat model, notification taxonomy, promotion/rollback standards, program completion definition,
compatibility map) that the concurrent Codex kernel lane and the subsequent bootstrap/scheduler/execution
lanes build against. No kernel code, scheduler workflow, or bootstrap logic is implemented in this lane --
it is documentation and JSON Schema only, entirely within the declared file-scope lock
(`docs/05_operations/autonomy/**` and `docs/06_status/autonomy/**`).

Grounded throughout in the real existing mechanisms this program must stay compatible with:
`EXECUTION_TRUTH_MODEL.md`, `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`, `DELEGATION_POLICY.md`,
`OPERATING_MODEL_SONNET5.md`, `docs/governance/CONCURRENCY_CONFIG.json`,
`docs/governance/LANE_CONCURRENCY_POLICY.md`, `scripts/ops/lease-registry.ts`, `scripts/ops/merge-mutex.ts`,
`.github/workflows/track-a-monitor.yml`, `.claude/commands/loop-dispatch.md`, `.claude/commands/dispatch.md`.
Notably, `docs/05_operations/autonomy/CRASH_RESTART_SEMANTICS.md` cites the real `merge-mutex.ts`
`orphaned_pid` false-positive observed in this repo on 2026-07-23 (a naive PID-alive liveness check
misfiring against sequential short-lived `tsx` invocations) and mandates the already-proven
`lease-registry.ts` heartbeat+TTL liveness pattern instead, so AUT-2's kernel does not repeat that mistake.

## What this authorizes

Nothing runtime-facing -- this is a pure contract-authoring lane. It authorizes AUT-2 (Codex kernel
implementation, `scripts/autonomy/**`) and subsequent AUT-3 through AUT-6 lanes to build against a fixed,
ratified integration contract rather than each independently interpreting the parent program directive.
Per the program directive, this PR requires independent Codex adversarial review before PM sign-off -- this
lane does not merge itself, does not post a `pm-verdict/v1`, and does not apply the `t1-approved` label.

## ASSERTIONS:

- [x] All 15 deliverables present under the two locked paths, each as its own focused document (or JSON
      Schema for the three schema deliverables) -- see `docs/05_operations/autonomy/README.md`'s document
      index for the full deliverable-to-file mapping
- [x] Every JSON Schema (`dispatch_packet_v1`, `autonomy_execution_state_v1`, `audit_event_v1`) parses as
      valid JSON (verified via `node -e "JSON.parse(...)"` against each file)
- [x] The dispatch-packet schema's `tier` enum is `["T2","T3"]` -- no representable T1 value, so a T1
      dispatch attempt fails schema validation, not a runtime check that could be bypassed
- [x] No mode in the state machine, and no row in the authority matrix, grants T1, production, or
      credential authority to any actor, under any condition (grep-verified: every "T1" mention in the
      contract set is negative/exclusionary -- see `grep -rn "t1_live\|grant.*T1"` sweep in review notes)
- [x] Crash/restart semantics explicitly mandate heartbeat+TTL liveness (`lease-registry.ts` pattern), not
      raw PID-alive checks (`merge-mutex.ts`'s proven-flawed pattern for this use case)
- [x] Kill switch has two independent layers (in-band flag + out-of-band GitHub-level control) so a buggy
      or compromised kernel cannot make itself unkillable
- [x] Program completion definition is a falsifiable, artifact-checkable list (10 rows), not narrative --
      tied explicitly to the program directive's "not complete until T2/T3 unattended operation is
      certified in production use" language
- [x] Reserved paths for the concurrent emergency-stabilization lane (`docs/06_status/lanes/UTV2-1571.json`,
      `docs/06_status/proof/UTV2-1571/**`, `.github/workflows/post-merge-lane-close.yml`,
      `scripts/ops/lane-close.ts`/`lane-close.test.ts`) never read, written, or referenced anywhere in this
      diff
- [x] No file outside `docs/05_operations/autonomy/**` and `docs/06_status/autonomy/**` touched, except the
      pre-existing lane manifest/sync commit already on this branch before this lane's work began
- [x] `pnpm verify` PASS (full pipeline, including `pnpm test:db` per T1 tier policy)
- [x] `r-level-check` PASS, no rules matched (docs-only diff does not intersect any `r1-r5-rules.json` path)

## EVIDENCE:

```text
$ git fetch origin main --quiet
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 20
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ node -e "JSON.parse(require('fs').readFileSync('docs/05_operations/autonomy/schemas/dispatch_packet_v1.schema.json','utf8')); console.log('dispatch_packet valid')"
dispatch_packet valid
$ node -e "JSON.parse(require('fs').readFileSync('docs/05_operations/autonomy/schemas/autonomy_execution_state_v1.schema.json','utf8')); console.log('execution_state valid')"
execution_state valid
$ node -e "JSON.parse(require('fs').readFileSync('docs/05_operations/autonomy/schemas/audit_event_v1.schema.json','utf8')); console.log('audit_event valid')"
audit_event valid
```

```text
$ pnpm verify
(full pipeline: ops:sync-check, ops:system-alignment-check, ops:automation-coverage-check, env:check,
 lint, type-check, build, test, smart-form verify, verify:commands, pnpm test:live-db)

[sync-check] OK (per-issue): branch "claude/utv2-1577-autonomy-contracts-threat-model" <-> .ops/sync/UTV2-1577.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15

... (type-check, lint, build all clean; unit test suite green) ...

... pnpm test:live-db (T1-required live-DB proof), representative closing TAP block: ...
TAP version 13
# Subtest: [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
ok 1 - [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
  ---
  duration_ms: 1178.474966
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2254.055977

Aggregate across the full pnpm verify run (112 TAP suites total, including all pnpm test:live-db suites):
  total "# pass": 3827
  total "# fail": 0
  total "not ok" lines: 0
  ELIFECYCLE / npm error occurrences: 0
```

`pnpm type-check` and `pnpm test` both ran and passed as steps within `pnpm verify` above (see the
`verify:static` script composition: `... && pnpm type-check && pnpm build && pnpm test && ...`).
