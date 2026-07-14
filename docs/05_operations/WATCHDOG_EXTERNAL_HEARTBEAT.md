# Watchdog-for-Watchdogs External Heartbeat

**Issue:** UTV2-1502  
**Status:** Design only — no production configuration or deployment is authorized by this document.

## Purpose

Unit Talk has several scheduled monitors, reconcilers, and watchdogs. Their
successful execution must be observable outside the process or GitHub Actions
run that performs the work; otherwise a scheduler, credential, workflow, or
notification failure can leave the system silently unmonitored.

This design uses a dead-man's-switch pattern: each protected job reports a
success heartbeat to an external monitor only after its meaningful work and
alert path have completed. A missing heartbeat is an alert condition.

## Current Inventory

| System | Current cadence | Current outcome | Blind spot addressed by external heartbeat |
| --- | --- | --- | --- |
| CI Dispatch Watchdog (`ci-dispatch-watchdog.yml`) | Every 15 minutes | Detects missing CI runs and can re-dispatch Merge Gate | The workflow itself may not start or may fail before Linear alerting. |
| Ingestor Staleness Alert (`ingestor-staleness-alert.yml`) | Every 5 minutes | Checks provider-offer and ingestion freshness; alerts ops | A disabled/stalled GitHub schedule or invalid secret can stop freshness detection. |
| Stale Lane Alerter (`stale-lane-alerter.yml`) | Every 6 hours | Reports stale lanes and leases to the ops webhook | Lane drift can become invisible if the workflow fails. |
| Ops Reconcile (`ops-reconcile.yml`) | Daily, 06:00 UTC | Reconciles stranded lane manifests and commits mutations | Reconciliation can stop while manifests continue to drift. |
| Daily Ops Digest (`ops-daily-digest.yml`) | Weekdays, 17:07 UTC | Surfaces dispatch candidates, stale lanes, and CI failures | The routine operational review signal can disappear silently. |
| Pipeline Health Monitor (`pipeline-health-monitor.yml`) | Daily, 10:00 UTC | Detects pipeline anomalies and opens a Linear issue | The monitor and its issue-creation path can both fail without an independent signal. |
| Ingestor process heartbeat | In-process; freshness ceiling is 20 minutes by default | Detects a wedged ingest loop and forces a restart | Host-local checks do not prove GitHub watchdogs or their alert paths are running. |

The repository also contains `track-a-monitor.yml`, burn-in monitoring, and
other scheduled quality checks. They may be added after the first rollout once
the external-heartbeat path has proven stable; the systems above are the
minimum set because they monitor/reconcile production and execution health.

## Existing Uptime Kuma Option

The repository already includes an Uptime Kuma deployment definition at
`deploy/monitoring/docker-compose.monitoring.yml` and an idempotent provisioning
script at `deploy/monitoring/provision-kuma-monitors.sh`. The script currently
creates five monitors: API health, host ping, worker liveness, ingestor
freshness, and Discord bot health, with a Discord Ops notification.

That is an implementation option, not evidence that the service is currently
running or reachable in production. Before use, an operator must confirm its
deployment, ownership, notification route, and a securely stored push URL. No
Kuma monitor, secret, workflow, or deployment may be changed without the PM
gate described below.

## External Heartbeat Requirements

1. Use a monitor outside the protected GitHub Actions job. A Uptime Kuma Push
   monitor is suitable when it is independently available from GitHub Actions.
2. Create one named push monitor per protected workflow. Its grace period must
   be longer than the workflow cadence plus expected GitHub scheduling delay
   and maximum job runtime; it must not be inferred from a process PID or log
   line.
3. Send the heartbeat only after the job's meaningful command succeeds and its
   required alert/reconcile output has been persisted. A failed, skipped, or
   partial job must not report success.
4. Store each push URL as a repository/environment secret. Never commit it,
   print it, or place it in artifacts or step summaries.
5. Alert the existing Discord Ops route with the workflow name, last expected
   heartbeat time, run URL when available, and a runbook link. Alerts must be
   deduplicated until recovery; a recovery notification is required.
6. Keep the heartbeat action additive and non-authoritative. A missed external
   heartbeat pages an operator; it must not auto-merge, restart production,
   mutate a lane, or change runtime configuration.
7. Verify the observer's failure domain. Kuma on the production host can detect
   a missing GitHub heartbeat, but it cannot independently prove that its own
   host is available. Retain an independently hosted external availability
   check for the public health/status surface, or record an accepted exception.
8. Test both paths before declaring coverage: a normal successful workflow
   heartbeat and an intentionally withheld heartbeat that reaches alert state
   and then recovers. Use a non-production monitor or maintenance window for
   the withheld-heartbeat test.

## Proposed Rollout

1. **PM approval:** approve the monitor owner, notification destination,
   external failure-domain choice, secret storage location, cadence/grace
   thresholds, and test window.
2. **Provisioning:** create the named Push monitors and repository secrets;
   confirm Discord Ops delivery. This is a production configuration mutation
   and is outside UTV2-1502's authorized implementation scope.
3. **Workflow wiring:** append a final success-only heartbeat step to the six
   systems in the inventory. Use the same small, fail-closed helper so URL
   validation, timeout, and redaction behavior cannot drift.
4. **Evidence:** capture monitor configuration (with secrets redacted), one
   successful heartbeat per workflow, one overdue alert, and one recovery.
5. **Review:** after seven days of clean operation, assess the remaining
   scheduled monitors and decide whether to extend coverage.

## Implementation Follow-up

Create a PM-gated implementation issue with this title:

> `feat(ops): add external heartbeats for scheduled watchdog workflows`

Acceptance criteria for that issue:

- Provision approved Uptime Kuma Push monitors (or an approved equivalent) for
  CI Dispatch Watchdog, Ingestor Staleness Alert, Stale Lane Alerter, Ops
  Reconcile, Daily Ops Digest, and Pipeline Health Monitor.
- Add a shared success-only heartbeat helper and wire only the approved
  workflows.
- Keep push URLs secret and prove logs/artifacts redact them.
- Demonstrate overdue alert and recovery notification through Discord Ops.
- Record the independent external availability check or approved exception.
- Do not add automatic restart, merge, deployment, or runtime mutation.

The follow-up must be planned as a production-configuration change, receive a
PM gate before provisioning/deployment, and include its own runtime proof.

## Decision Record

UTV2-1502 establishes the required design and identifies the Uptime Kuma
option already present in the repository. It intentionally does not provision
monitors, add secrets, alter GitHub workflows, deploy anything, or claim that
the external heartbeat is live.
