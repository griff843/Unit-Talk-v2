# UTV2-1476 Diff Summary

Issue: UTV2-1476
Tier: T2
Lane type: governance
Branch: claude/utv2-1476-readiness-ledger-refresh
Head SHA: (pre-merge; bound post-merge)

## Changes

- `docs/06_status/readiness/readiness-score.json` — refreshed from a 127h-stale hand-authored snapshot (`generated_at: 2026-06-29T22:05:00Z`) to current live evidence (`generated_at: 2026-07-06T18:00:00Z`). Verdict moves from a stale `GREEN` to an honest `RED`:
  - `deploy_sha_alignment`: now `fail` — production (`8deccace`, deployed 2026-06-30) is 6+ days behind main HEAD (`5fe69db9`/current), no deploy has run since.
  - `ingestor_health`: now `fail` — reclassified `BLOCKED_EXTERNAL` per the UTV2-1477 P0 investigation (SGO provider-side outage/account-probe rejection, not a code defect or invalid credential; tracked for a resilience fix in UTV2-1478).
  - `worker_outbox_health`: remains `pass` — confirmed via `worker.heartbeat` system_runs freshness (611 heartbeats in the trailing hour) that the worker is healthy-idle, not wedged; it has zero claimable rows for its configured target (tracked: UTV2-1479).
  - `dead_letter_count`, `db_tripwires`, `pnpm_verify`, `proof_coverage`, `constitution_convergence`: refreshed evidence, same pass/fail status as before.
- `.github/workflows/readiness-refresh.yml` (new) — scheduled workflow (every 12h + manual dispatch) that checks `readiness-score.json` staleness independent of any PR and opens/updates a GitHub issue when the ledger exceeds a 36h warn threshold (ahead of the existing 48h hard merge-gate threshold in `readiness-regression-gate.yml`), closing the issue automatically once the ledger is refreshed. This is the "reminder mechanism" narrow option from the issue text — chosen over wiring `readiness-report.mjs`'s live signals directly into the ledger, because that script's `ingestor_health`/`worker_runtime` dimensions currently read from unreliable/legacy sources (out of scope per the issue's "do not redesign the dimension taxonomy or evidence-collection logic in readiness-report.mjs").
- `docs/06_status/lanes/UTV2-1476.json` — lane manifest scope correction (removed unused planned files, added the actual touched files and proof paths).

## Scope

Docs + workflow only. No runtime, domain, contract, or migration paths touched. `scripts/readiness-report.mjs` is unchanged — its dimension/evidence-collection logic is explicitly out of scope for this issue.

## SHA Binding

Head SHA: (recorded at PR open)
Merge SHA: N/A (bound post-merge)
