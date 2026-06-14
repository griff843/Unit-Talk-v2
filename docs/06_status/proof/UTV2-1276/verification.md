# UTV2-1276 — Verification

Durable GitHub Actions scheduled workflow for the Track A (UTV2-1250) CLV-path monitor.

Tier: **T2**. Lane type: ops/runtime tooling (scheduled workflow + read-only monitor script + tests).

## Merge SHA

`f8919d52b234031e75f6df9b79cdf12b546b17f0` (PR #1022, merged to main 2026-06-14)

## What shipped

- `.github/workflows/track-a-monitor.yml` — scheduled every 6h (`23 */6 * * *`) + `workflow_dispatch`; least-privilege `permissions: contents: read`; secrets passed as env, never echoed; uploads the snapshot artifact.
- `scripts/ops/track-a-monitor.ts` — read-only consolidated monitor. Collects the snapshot via PostgREST counts, reads prior state from the latest UTV2-1250 monitor comment, evaluates triggers, writes `--output-json`, and posts a Linear comment only on trigger.
- `scripts/ops/track-a-triggers.ts` — pure trigger logic + snapshot types (no I/O).
- `scripts/ops/track-a-triggers.test.ts` — 11 unit tests for the trigger logic.
- `scripts/ci/track-a-monitor-workflow.test.ts` — 4 tests validating the workflow YAML (6h cron, dispatch, read-only perms, secrets-as-env / no-echo, artifact).
- `docs/06_status/proof/UTV2-1276/MONITOR_SPEC.md` — aligned to the consolidated monitor.
- `package.json` — both test files registered in `test:ops`.

## Required proof (per PM decision 2026-06-13)

| Requirement | Status | Evidence |
|---|---|---|
| Workflow YAML validates (parse + structure) | ✅ | `scripts/ci/track-a-monitor-workflow.test.ts` — 4/4 pass |
| Runnable manually via `workflow_dispatch` | ✅ | `on.workflow_dispatch` present (asserted by test) |
| Scheduled cadence is every 6 hours | ✅ | `cron: '23 */6 * * *'` (asserted by test) |
| Secrets are not printed | ✅ | secrets only in step `env`; YAML test asserts no `echo` of secret values; `permissions: contents: read` |
| Read-only DB access confirmed | ✅ | live dry-run below — counts only, no writes; `errors: []` |
| Output matches MONITOR_SPEC.md | ✅ | snapshot fields == MONITOR_SPEC field list |
| `pnpm verify` green | ✅ | exit 0; 103 test suites, 0 failures (incl. new tests) |

## Live read-only dry-run (2026-06-13, against prod Supabase)

```
[track-a-monitor] snapshot: {"settledClvPathNative":0,"closingForClvTotal":177,
 "closingForClvBackfilled":172,"closingForClvNative":5,"wellFormedPendingPlayerProps":1848,
 "wellFormedSettledPlayerProps":219,"clvComputed":386,"clvMissingEventContext":1960,
 "clvMissingClosingLine":212,"suppressPicks":9829,"publicDiscordRecentPosts":null,"errors":[]}
[track-a-monitor] decision: {"shouldReport":true,"isBaseline":true,
 "recommendation":"continue monitoring — settled CLV-path below DEVELOPING threshold"}
```

`settledClvPathNative=0` matches the PM-recorded UTV2-1250 baseline (0 settled CLV-path picks),
confirming the native-vs-backfill exclusion is correct (172 backfilled rows excluded; the
≥50 threshold trigger will not false-fire).

## Guardrails honored

Read-only (counts/selects only); no production mutation; no certification; does not mark
UTV2-1042/1250 Done; no CLV/ROI/edge claims; `publicDiscordRecentPosts` always null (no
delivery query/change); no backfill; secrets never printed.

## Verification

- `pnpm lint` (new files): clean (exit 0).
- `pnpm verify`: **green — exit 0** (sync-check, system-alignment, automation-coverage, env:check, lint, type-check, build, full test matrix, smart-form verify, verify:commands all passed; 103 suites, 0 failures).
- Unit tests: `track-a-triggers.test.ts` 11/11 pass; `track-a-monitor-workflow.test.ts` 4/4 pass.

### Live-DB proof — `pnpm test:db`

`pnpm test:db` (apps/api database smoke against real Supabase) — the same live DB this
monitor reads — passed, confirming connectivity and schema integrity:

```
# tests 7
# pass 7
# fail 0
# skipped 0
# todo 0
# duration_ms 111707
```

## R-level check

`scripts/ci/r-level-check.ts` — R-level compliance verified: T2 lane; no runtime T1 artifacts required. CI ran `pnpm type-check` (TypeScript project-references build check) and `pnpm test` (full test matrix) on the PR head SHA; both green on merge.
