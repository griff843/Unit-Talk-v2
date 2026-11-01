# Diff summary: WORK-2026103006

MERGE_SHA: pending merge

A missing kill-switch repository now stops every non-canary Discord target before a claim, with a distinct result and structured skip log. Thrown or rejected reads also stop delivery. `discord:canary` remains exempt.

| File | Change |
|---|---|
| apps/worker/src/runner.ts | Unwired and read-error refusals; result types and queue metrics accept both statuses. |
| apps/worker/src/worker-runtime.test.ts | Explicit released stub; nine new adversarial and positive-control cases. |
| apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts | Explicit released stub for existing synthetic restart fixtures. |

The unwired check precedes the registry check so a canonically blocked destination also reports missing wiring. The registry block remains enforced. No production mutation, switch release, deployment, API change, or destination-audience change.

Database `isKilled` returns true for reported query errors and missing rows, but does not catch rejected reads; the runner now contains those exceptions.

Verified source: `ea13cf2b4db1662f772f2304d08c20043aa3cad7`. Merge SHA: pending merge. Final executor attestation, PM approval, governed merge, lane finalization and post-merge reconciliation remain pending.
