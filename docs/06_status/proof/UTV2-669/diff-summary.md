# UTV2-669 Diff Summary — Daily ops health digest

## What changed

### New: `scripts/ops/linear-client.ts`
Thin shared Linear GraphQL client (~75 lines). Accepts token explicitly — no dependency on `@unit-talk/config`. Used by `daily-digest.ts` and available for future ops scripts.

**Exports:**
- `linearQuery<T>(query, variables, options)` — raw GraphQL fetch; returns `{ ok, data?, error? }` and never throws.

### New: `scripts/ops/daily-digest.ts`
Orchestrates four read-only sources into a structured daily ops report.

**Sources:**
| Source | Input | Graceful degradation |
|---|---|---|
| Manifest zombie check | `readAllManifests()` — local read | always available |
| ci-doctor failures | `pnpm ops:ci-doctor -- --json` subprocess | `infra_error` entry, returns `[]` |
| Linear active/backlog | Linear GraphQL API | `infra_error` entry, skipped |
| Fibery open controls | Fibery API commands | `infra_error` entry, returns `[]` |

**Output schema:**
```json
{
  "schema_version": 1,
  "run_at": "...",
  "mode": "local|scheduled",
  "stale_lanes": [...],
  "ci_failures": [...],
  "linear": { "active_lanes": [...], "backlog_top3": [...], "skipped": bool },
  "fibery_blockers": [...],
  "recommended_next": [...],
  "infra_errors": [...],
  "brief_text": "..."
}
```

**Discord alert condition:** `stale_lanes.length > 0 || ci_failures.length > 0` — Fibery blockers alone do NOT page.

**Read-only guarantee:** No `writeManifest`, `updateManifest`, or any state mutation calls.

### New: `.github/workflows/ops-daily-digest.yml`
Scheduled workflow running at 08:00 UTC daily and on `workflow_dispatch`. Uploads digest report as artifact with 30-day retention.

### Updated: `package.json`
Added `ops:digest` script entry: `tsx scripts/ops/daily-digest.ts`.

### Updated: `docs/05_operations/REQUIRED_SECRETS.md`
Updated `used_by` for `FIBERY_API_URL`, `FIBERY_API_TOKEN`, and `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` to include `.github/workflows/ops-daily-digest.yml`. No new secrets — all five secrets referenced by the new workflow were already in the canonical inventory.

## Local test result

```
[daily-digest] run_at=2026-04-19T16:38:20.689Z mode=local
  stale_lanes:    0
  ci_failures:    0
  active_lanes:   0 (skipped)
  backlog_top3:   0 (skipped)
  fibery_blockers: 0
  infra_errors:   2
    LINEAR_API_TOKEN not set — skipping Linear summary
    FIBERY_API_URL or FIBERY_API_TOKEN not set — skipping Fibery blockers
  verdict: CLEAN
```

JSON mode output: valid, stable, matches schema above.

13 manifests scanned. 0 stale lanes (all in_progress lanes have fresh heartbeats). 0 ci_failures (ci-doctor reports 0 `fail` checks; INFRA verdict is expected locally — no GITHUB_TOKEN). Token skips for Linear and Fibery are expected infra_errors, not failures.
