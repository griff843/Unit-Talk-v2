# Diff summary: WORK-2026100901

Verified source snapshot: `bc4ff73c7f75a2e6184a247cfb2358ae318668e8`.

Implementation change commit: `892634bf61b91806f8a888ab475308f91b015a0a`.

This second rework implements the owner/PM query-shape correction on PR #1728. The lane remains narrowed to the health gap only.

| Files | Change |
|---|---|
| `apps/api/src/routes/health.ts` | Treat unreadable zombie evidence as `unknown`, degrade `/health`, and return HTTP 503. Resolve authorized delivery-eligible human-capper picks to `discord:official-picks`, while excluding Track Only, terminal, fixture, and live-killed-target cases. |
| `packages/db/src/runtime-repositories.ts` | Read the promoted/non-null-target branch and authorized delivery-eligible human-capper branch through separate server-filtered, fully paginated queries; deduplicate and contract-recheck the union. The health check no longer pages the full draft/validated population. |
| `apps/api/src/server.test.ts` | Retain the health regressions and mutation controls, and add a database query-shape regression that proves lifecycle plus both candidate branches are filtered before pagination. |
| `docs/06_status/proof/WORK-2026100901/*` | Rebind health-only regression, static, runtime-deferral, and model-routing evidence for review. |

The prior replay expansion, readiness never-claimed implementation, pipeline-freshness change, and generated readiness-score change were restored exactly to `origin/main`. In particular, `discord:official-picks` remains excluded from replay under the first-release policy.

No schema, migration, dependency, endpoint, presentation, kill-switch state, outbox row, containment state, or production data was changed. Runtime probes were read-only and failed closed.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1728
Execution SHA: bc4ff73c7f75a2e6184a247cfb2358ae318668e8
