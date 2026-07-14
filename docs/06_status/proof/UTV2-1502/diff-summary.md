# Diff Summary — UTV2-1502

**Issue:** UTV2-1502 — Watchdog-for-Watchdogs External Heartbeat  
**Tier:** T2  
**Branch:** `codex/utv2-1502-watchdog-external-heartbeat`  
**Merge SHA:** Pending merge

## Files Changed

- `docs/05_operations/WATCHDOG_EXTERNAL_HEARTBEAT.md` — inventories existing
  monitor/reconcile/watchdog systems and defines the PM-gated external
  heartbeat design, Uptime Kuma option, rollout, and implementation follow-up.
- `docs/06_status/proof/UTV2-1502/diff-summary.md` — this scoped change
  summary.
- `docs/06_status/proof/UTV2-1502/verification.md` — T2 verification record.

## Scope Compliance

The implementation is documentation-only and stays within the lane's three
authorized paths. It makes no production configuration, secret, deployment,
workflow, runtime, or database mutation.

## Outcome

The design identifies the repository's existing Uptime Kuma deployment option,
defines success-only external heartbeats for the critical scheduled watchdog
workflows, requires an independent observer failure domain, and supplies a
bounded PM-gated implementation follow-up.
