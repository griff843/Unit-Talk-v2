# Diff summary: WORK-2026100501

| File | Change |
|---|---|
| `.github/workflows/executor-result-validator.yml` | Publishes the protected result as the native `pull_request` job; comment/manual events retry only the newest exact-PR/exact-HEAD eligible run. |
| `.github/workflows/merge-gate.yml` | Publishes Merge Gate natively, preserves tier/PM policy, and routes review/comment/manual refresh through exact-HEAD reruns. |
| `scripts/ops/executor-result-check-selection.cjs` | Adds deterministic eligible workflow-run selection without falling back past a newer unavailable run. |
| `scripts/ops/executor-result-validate.ts` | Models native publication, refresh-only events, and ignored events explicitly. |
| `scripts/ops/*.test.ts` | Covers positive/negative verdicts, stale HEAD, retry selection, unsupported events, native publication, distinct skipped-job identities, and trusted-base permissions. |
| Lane work/sync/manifest and this proof directory | Records bounded authority, root-cause API evidence, verification, routing provenance, and the separate read-only settlement observation. |

No product, Discord, scoring, grading, routing, provider, pricing, activation, migration, contract, domain, or settlement implementation changed.

## SHA Binding

Implementation SHA: `fceee677ba1c817c964fdf93ca17e5a96c95e434`

Merge SHA: pending merge
PR: pending
