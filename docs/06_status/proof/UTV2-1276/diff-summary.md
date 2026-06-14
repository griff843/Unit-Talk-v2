# UTV2-1276 — Diff Summary

Durable GitHub Actions monitor replacing the session-only Track A cron (UTV2-1250 watch).

## Added

- `.github/workflows/track-a-monitor.yml` — scheduled workflow, `cron: '23 */6 * * *'` + `workflow_dispatch`; `permissions: contents: read`; Supabase + Linear secrets as step env (never echoed); uploads snapshot artifact (14d retention).
- `scripts/ops/track-a-monitor.ts` — read-only consolidated monitor. PostgREST counts only; reads prior state from the latest UTV2-1250 monitor comment; evaluates triggers; writes `--output-json`; posts a Linear comment only on trigger; exits 0 always.
- `scripts/ops/track-a-triggers.ts` — pure trigger logic + snapshot types (no I/O), unit-testable.
- `scripts/ops/track-a-triggers.test.ts` — 11 unit tests (baseline, steady-state, heartbeat, threshold, movement deltas, blocker, backfill-exclusion).
- `scripts/ci/track-a-monitor-workflow.test.ts` — 4 tests validating the workflow YAML (cadence, dispatch, read-only perms, secrets-as-env/no-echo, artifact).
- `docs/06_status/proof/UTV2-1276/{verification,diff-summary}.md`, `docs/06_status/lanes/UTV2-1276.json`.

## Modified

- `package.json` — registered both new test files in `test:ops`.
- `docs/06_status/proof/UTV2-1276/MONITOR_SPEC.md` — aligned to the consolidated monitor; GHA is the primary runner, session cron is temporary backup.

## Behavior / risk

- **Read-only**: only `select`/count queries; no insert/update/delete; no migrations; no delivery.
- **Fail-soft**: read errors are captured as `errors[]` (reported as a blocker) and the monitor exits 0 — it never blocks the workflow.
- **No semantics change**: no scoring/intake/candidate/provenance code touched.
- **Threshold correctness**: settled CLV-path excludes backfilled snapshots (`payload->>backfill='true'`); live baseline = 0, matching PM's UTV2-1250 baseline.

## Scope boundary

No production code paths, no `apps/*/src` runtime changes, no schema/migrations, no `database.types.ts`.
