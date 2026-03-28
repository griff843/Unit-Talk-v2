# UTV2-106 — Worker Runtime Authority and Execution Contract

> **Status:** Ratified 2026-03-28
> **Tier:** T1 — Governing contract; implementation requires this contract
> **Owner:** Architecture
> **Authority tier:** Tier 4 — Operational Docs
> **Issue:** UTV2-106

---

## 1. Purpose

This contract defines:

- Canonical worker runtime ownership
- What counts as healthy worker execution
- Operator-visible proof expectations for outbox drain and delivery progression
- Minimal acceptable startup/run model for the current stage of the platform
- Explicit out-of-scope boundaries so downstream implementation (Codex) stays bounded

---

## 2. Runtime Ownership

### The worker is a separate process

The distribution worker (`apps/worker`) is **not** co-located with the API process. It must be started independently.

| Process | Starts | Owns |
|---------|--------|------|
| `apps/api` | Recap scheduler (in-process), API routes, submission intake | `distribution_outbox` rows (writes them) |
| `apps/worker` | Distribution delivery loop | `distribution_outbox` rows (claims and drains them) |

**Neither process auto-starts the other.** The API enqueues outbox rows. The worker drains them. Both must be running for end-to-end pick delivery.

### Worker startup requirement

The worker requires `UNIT_TALK_WORKER_AUTORUN=true` in the environment to run delivery cycles. Without it, the process prints a JSON summary and exits. This is intentional — prevents accidental double-runs in environments where the env var is absent.

### Required environment variables

| Variable | Purpose |
|----------|---------|
| `UNIT_TALK_WORKER_AUTORUN` | Must be `true` to run cycles |
| `SUPABASE_URL` | Live DB connection |
| `SUPABASE_SERVICE_ROLE_KEY` | DB service role credentials |
| `DISCORD_BOT_TOKEN` | Discord delivery adapter auth |
| `UNIT_TALK_DISCORD_TARGET_MAP` | JSON map of `discord:target` → channel ID |

### Poll interval

Default `pollIntervalMs = 5000` (5 seconds). Configurable via env. The worker polls `distribution_outbox` on each interval, claims eligible rows, delivers, and records receipts.

---

## 3. Healthy Execution Definition

A worker is considered **healthy** when all of the following are true:

| Condition | Healthy state |
|-----------|--------------|
| `counts.pendingOutbox` | Draining toward 0 over time (not accumulating) |
| `counts.sentOutbox` | Increasing when qualified picks have been submitted |
| `counts.failedOutbox` | 0, or transitioning → dead_letter within expected retry policy |
| `counts.deadLetterOutbox` | 0 (non-zero degrades distribution health) |
| `workerStatus` in operator snapshot | `healthy` (not `degraded` or `down`) |
| Receipt records | New `distribution_receipts` rows appear after outbox rows are claimed |

A worker is **not** healthy when:
- `counts.pendingOutbox` is non-zero and not draining (stale, unclaimed rows)
- `counts.deadLetterOutbox` > 0
- No `distribution_receipts` rows are written for rows that should have been claimed
- Worker process is not running (`UNIT_TALK_WORKER_AUTORUN` absent or false)

---

## 4. Operator-Visible Proof Expectations

Proof that the worker is running and delivering picks is observable without internal worker access.

### At `GET /api/operator/snapshot`

| Field | Expected when worker is healthy |
|-------|---------------------------------|
| `health.distribution` | `healthy` |
| `counts.pendingOutbox` | 0 or decreasing |
| `counts.sentOutbox` | ≥ number of successfully delivered picks |
| `counts.failedOutbox` | 0 in steady state |
| `counts.deadLetterOutbox` | 0 in steady state |
| `recentOutbox[*].status` | `sent` for delivered rows |

### In `distribution_receipts` (DB)

Each successfully delivered outbox row produces one `distribution_receipts` row with:
- `outbox_id` → the claimed outbox row
- `channel` → resolved Discord target channel ID
- `discord_message_id` → non-null (proof of Discord delivery)
- `idempotency_key` → unique partial index; prevents double-record

### In `audit_log` (DB)

Each delivered pick produces a `distribution.sent` audit entry with `entity_ref = pick_id`.

---

## 5. Minimal Startup / Run Model

The canonical way to start the worker for the current stage of the platform:

```bash
UNIT_TALK_WORKER_AUTORUN=true \
SUPABASE_URL=<url> \
SUPABASE_SERVICE_ROLE_KEY=<key> \
DISCORD_BOT_TOKEN=<token> \
UNIT_TALK_DISCORD_TARGET_MAP='{"discord:best-bets":"<channel_id>","discord:trader-insights":"<channel_id>","discord:canary":"<channel_id>"}' \
node --import=tsx/esm apps/worker/src/index.ts
```

Or via `pnpm --filter @unit-talk/worker start` if a start script is wired.

**Graceful shutdown:** The worker responds to `SIGTERM` and `SIGINT`. Shutdown drains in-flight claims before exit. Do not `SIGKILL` a running worker mid-claim unless the claim is known to be safe (idempotency key prevents double-delivery on restart).

---

## 6. Current State (as of ratification 2026-03-28)

| Observation | State |
|-------------|-------|
| Worker process running in production | **NO** — must be started manually |
| Pending outbox rows | 5 (from UTV2-103 lifecycle proof, not drained) |
| `counts.sentOutbox` | 7 (prior successful deliveries) |
| Dead-letter / failed | 0 |

The 5 pending outbox rows are not a failure state — they are expected pending rows from test submissions during UTV2-103 proof that were submitted when the worker was not running. They will drain on next worker start.

**Worker start is the next operational action required for outbox health.**

---

## 7. Out of Scope

The following are explicitly out of scope for this contract and for any Codex implementation bounded to this contract:

| Out of scope | Reason |
|-------------|---------|
| Auto-starting the worker from the API process | Separate process ownership is a design constraint — do not collapse |
| Kubernetes / Docker / PM2 process management | Infrastructure layer — not defined here |
| Worker horizontal scaling / multi-instance coordination | Requires a separate contract; idempotency_key gives partial protection but multi-instance is not validated |
| Worker health endpoint (HTTP) | Not required at current stage; operator snapshot is sufficient |
| Retry policy changes (dead-letter threshold) | Governed by `distribution_contract.md` — change there, not here |
| Changing poll interval semantics | Default 5000ms is sufficient; changes require a bounded issue |
| Grading cron startup | `grading-cron.ts` is a separate standalone runner; governed separately |
| Recap scheduler | In-process to API; governed by `UTV2-70_RECAP_AGENT_CONTRACT.md` |

---

## 8. Implementation Constraints for Codex

When Codex implements against this contract:

1. **Do not collapse API and worker into a single process.** They are separate by design.
2. **Do not change the `UNIT_TALK_WORKER_AUTORUN` guard.** It is an intentional safety check.
3. **Do not change `pollIntervalMs` default** without a bounded issue that updates this contract.
4. **Do not add retry policy changes** — those belong in the distribution contract.
5. **Receipt recording is idempotent** — the unique partial index on `idempotency_key` enforces this. Do not remove or bypass it.
6. Proof of "worker is healthy" = operator snapshot shows `counts.pendingOutbox` draining and `distribution_receipts` rows written.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/02_architecture/contracts/distribution_contract.md` | Distribution rules (retry, dead-letter thresholds) |
| `docs/05_operations/UTV2-70_RECAP_AGENT_CONTRACT.md` | Recap scheduler (API-in-process) |
| `docs/05_operations/discord_routing.md` | Discord target taxonomy and channel IDs |
| `docs/06_status/PROGRAM_STATUS.md` | Current operator snapshot state |
| `apps/worker/src/index.ts` | Worker entry point |
| `apps/worker/src/runner.ts` | `runWorkerCycles()` implementation |
| `apps/worker/src/distribution-worker.ts` | Per-item claim/deliver/receipt logic |
