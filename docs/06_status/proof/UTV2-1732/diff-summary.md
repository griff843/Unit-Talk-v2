# UTV2-1732 Diff Summary

MERGE_SHA: b9e7f33ca7ee0f01fb511bf9198d3dc7b03ae321

> Pre-merge this anchor is the verified substantive implementation SHA. Post-merge closeout must rebind it to the authoritative merge SHA.

Verified source SHA: `b9e7f33ca7ee0f01fb511bf9198d3dc7b03ae321`

Base: `origin/main` at `efdbd298`

PR: https://github.com/griff843/Unit-Talk-v2/pull/1437

Generated: 2026-08-22T06:06:39Z

## Implementation

- `execution-packet.ts` defines and validates the complete task contract, preserves the exact Linear snapshot, and refuses missing, mismatched, or malformed contracts. The contract hash is integrity/drift detection, not tamper-resistance: it is re-derived from the record it validates, so a consistent edit to both the sync record and the manifest satisfies it.
- `lane-start.ts` captures fresh Linear authority before executor spawn, seals its hash into the lane manifest, and reuses a contract only when that manifest binding already exists.
- `codex-exec.ts` and `claude-exec.ts` consume the same rendered contract, bind its hash to fresh/rework epochs, reject identity drift, and pass the control-plane checkpoint location to child processes.
- `execution-checkpoint.ts` permits one authorized correction brief after a checkpoint closes, seals it against later edits, renders exact findings/corrections, binds their hash to the rework epoch, and adds `retire` so a superseded epoch stops binding dispatch without deleting its record.
- Five focused test files cover the shared prompt contract, fail-closed boundaries, the sealed correction flow, hash binding, and control-plane checkpoint transport.

## Git Diff Stat

```text
.ops/sync/UTV2-1732.yml                  | 177 ++++++++++++++++++++++++
docs/06_status/lanes/UTV2-1732.json      |  57 ++++++++
scripts/ops/claude-exec.test.ts          |  24 +++-
scripts/ops/claude-exec.ts               | 128 +++++++++++++++++-
scripts/ops/codex-exec.test.ts           |  12 ++
scripts/ops/codex-exec.ts                |  69 ++++++----
scripts/ops/execution-checkpoint.test.ts |  87 ++++++++++++
scripts/ops/execution-checkpoint.ts      | 181 ++++++++++++++++++++++++-
scripts/ops/execution-packet.test.ts     |  90 ++++++++++++-
scripts/ops/execution-packet.ts          | 225 +++++++++++++++++++++++++++++++
scripts/ops/lane-start.test.ts           | 119 ++++++++++++++++
scripts/ops/lane-start.ts                | 151 +++++++++++++++++----
```

The lane manifest and proof-directory scaffold are lane-start bootstrap metadata. The substantive implementation commit changes only the eleven packet-authorized sync, executor, checkpoint, packet, lane-start, and test files listed above.

## Scope Boundaries

- No application runtime, database, migration, contracts, domain, worker, or workflow files changed.
- UTV2-1729 proof-binding implementation remains untouched by design.
- Post-merge UTV2-1729 re-dispatch and downstream recovery work remain separate orchestration actions.

## R-level Compliance

No rule in `docs/05_operations/r1-r5-rules.json` matches this governance/ops diff, so no R-level artifacts are required.
