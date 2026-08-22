# UTV2-1667 — diff summary

MERGE_SHA: 8856a4c1a089638e88fa12f251c2d1541afaad39

Three files: `scripts/ops/readiness-refresh.ts`, `scripts/ops/readiness-refresh.test.ts`, `.github/workflows/deploy.yml`, plus this lane's own manifest, sync file and proof bundle.

**No production mutation, activation, unpark, rollback, restart, queue replay, deploy, or secret change.** Production remains parked.

## Scope — the transferred requirement only

This lane implements the parked-readiness requirement carried over from the superseded UTV2-1660 attempt (PR #1365, closed unmerged), **not** the full Phase 1 design. No host journal, no `journal_sequence`, no §12a observer, no change to `deploy_sha_alignment`.

That is the slice the current RED verdict actually depends on, and the slice achievable without host provisioning.

## The gap this closes

`grep -n "parked" scripts/ops/readiness-refresh.ts` previously matched **nothing**. Readiness had zero parked-mode semantics while `deploy.yml` already implemented parked mode — so an intentionally parked service and an unexpectedly dead one produced the same verdict. That conflation is why four monitors read RED without distinguishing containment from failure.

## What changed

**`deploy.yml`** — the promote job already proved, per service, the compose project, exact image tag, effective process env (via `compose exec` *and* an independent `docker inspect`), and the public kill-switch state. It now publishes that finished proof as a `runtime-mode-receipt/v1` artifact bound to `(run_id, run_attempt, stage)`. Deployment mechanics are unchanged.

**`readiness-refresh.ts`** — new blocking dimension `service_runtime_mode` over `api`, `ingestor`, `worker`, with six states. The desired mode is **declared and independently verified, never inferred** — `SYNDICATE_MACHINE_ENABLED` is a protected secret this script cannot read, so the receipt carries the proof instead. `probeIngestorHealth` and `probeWorkerOutboxHealth` become mode-conditional.

In **active** mode, stale ingestor cycles and worker heartbeats remain hard failures at the unchanged 30-minute thresholds. In **parked** mode, absence of activity is expected *only* when every piece of parked evidence passes; any drift is a hard failure. `parked_verified` never reports as `healthy` — a test asserts the word never appears on that path.

## Two things deliberately not collapsed

1. **Ingestion stopped a month before parking.** That is surfaced as its own finding *under* `parked_verified`: parked mode explains the silence since, not the stoppage before it. Two different facts, two different findings.
2. **Stuck outbox rows fail in every mode**, including `parked_verified`. Parking is not an excuse for mid-flight work.

## Fail-closed by construction

`unreadable` is returned — never a guess — for a missing receipt, an in-flight deploy, a malformed receipt, a receipt bound to another run identity, an unreadable database, or an observation past the freshness SLA. It is never scored as passing.

A live read of the generator confirms this: the verdict stays **RED** with `service_runtime_mode = unreadable` and the exact `gh` error quoted. **Nothing was turned green.**

## Controls proved by inversion

Each control was removed or inverted and the suite re-run; the named tests went red and green again on restore. Presence plus a green run proves nothing.

The producer/consumer path is tested **executably**, not with a hand fixture: the test lifts the receipt block out of `deploy.yml`, runs it under `bash -euo pipefail`, and feeds the bytes it writes to this reader's parser.
