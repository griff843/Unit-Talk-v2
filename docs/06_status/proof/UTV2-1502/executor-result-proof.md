# PROOF: UTV2-1502
MERGE_SHA: f991cb2c8edb04b1131c5d676cb5622b0628913d

ASSERTIONS:
- [x] Identify current watchdogs/reconcile/cron/digest systems — PASS (7-system inventory table with cadence, current outcome, and blind spot addressed)
- [x] Define external heartbeat requirements — PASS (8 numbered requirements: dead-man's-switch pattern, per-workflow push monitor, grace period tied to cadence, secret storage, alert dedup/recovery, non-authoritative action, failure-domain independence, two-path test coverage)
- [x] Include Uptime Kuma option if already available — PASS (documents existing `deploy/monitoring/docker-compose.monitoring.yml` + `provision-kuma-monitors.sh`, explicitly notes it is an implementation option, not evidence of current production state)
- [x] No production config mutation unless PM approves — PASS (doc header states design-only; rollout plan requires PM approval before provisioning)
- [x] No deploy without PM gate — PASS (Decision Record explicitly states no monitors provisioned, no secrets added, no workflows altered, nothing deployed)
- [x] Produce implementation follow-up if needed — PASS (dedicated "Implementation Follow-up" section with issue title and acceptance criteria for the PM-gated implementation lane)

EVIDENCE:
```text
pnpm type-check
  PASS — no errors

pnpm test
  PASS — root aggregate test suite completed

pnpm verify
  PASS — full repository gate completed, including static checks and live-DB smoke tests

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS
  No R-level artifacts required for this diff
```

NOTES:
Docs-only design lane (docs/05_operations/WATCHDOG_EXTERNAL_HEARTBEAT.md), no code,
workflow, secret, or deployment paths touched.
