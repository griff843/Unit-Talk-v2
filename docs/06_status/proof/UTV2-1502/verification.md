# UTV2-1502 Verification

**Issue:** UTV2-1502 — Watchdog-for-Watchdogs External Heartbeat  
**Tier:** T2  
**Branch:** `codex/utv2-1502-watchdog-external-heartbeat`  
**Merge SHA:** Pending merge

## Verification

### Issue-specific verification

The design was checked against the repository sources that define the current
monitoring estate:

- `deploy/monitoring/docker-compose.monitoring.yml` confirms the repository
  includes an Uptime Kuma service definition.
- `deploy/monitoring/provision-kuma-monitors.sh` confirms the current
  provisioning path creates five operational monitors and a Discord Ops
  notification, but no Push monitors for scheduled watchdog workflows.
- The scheduled workflow definitions confirm the documented cadences and
  responsibilities for CI Dispatch Watchdog, Ingestor Staleness Alert, Stale
  Lane Alerter, Ops Reconcile, Daily Ops Digest, and Pipeline Health Monitor.
- No production configuration, secret, deployment, GitHub workflow, runtime,
  or database path was modified.

### pnpm type-check

PASS — `pnpm type-check` completed with exit code 0.

### pnpm test

PASS — `pnpm test` completed with exit code 0.

### pnpm verify

PASS — `pnpm verify` completed with exit code 0.

### R-level compliance

PASS — `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
reported three changed files and no matching R-level rules.

### Required model-routing evidence

Not generated in this lane. The lane manifest requires
`docs/06_status/proof/UTV2-1502/model-routing.json`, but that file is not in
the packet's `file_scope_lock`. The manifest specification assigns generation
of that evidence to `codex-exec`; creating it manually would violate the
declared scope. Resolve the scope mismatch or have the execution wrapper emit
the artifact before PR closeout.
