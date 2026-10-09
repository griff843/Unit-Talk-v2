# Diff summary: WORK-2026100901

Implementation source: `1a210d1a26412eb2f3b35e34429bd5d3fdc7328e`.

This rework implements the owner/PM `CHANGES_REQUIRED` verdict on PR #1728. The lane is narrowed to the health gap only.

| Files | Change |
|---|---|
| `apps/api/src/routes/health.ts` | Treat unreadable zombie evidence as `unknown`, degrade `/health`, and return HTTP 503. Resolve authorized delivery-eligible human-capper picks to `discord:official-picks`, while excluding Track Only, terminal, fixture, and live-killed-target cases. |
| `packages/db/src/runtime-repositories.ts` | Include canonically authorized delivery-eligible human-capper picks in the read-only zombie candidate population while preserving the existing promoted-pick population and complete ordered paging. |
| `apps/api/src/server.test.ts` | Add regressions for fail-closed health, authorized human-capper coverage, killed targets, and voided/settled exclusions, with mutation controls for the failure fallback and killed-target guard. |
| `docs/06_status/proof/WORK-2026100901/*` | Rebind health-only regression, static, runtime-deferral, and model-routing evidence for review. |

The prior replay expansion, readiness never-claimed implementation, pipeline-freshness change, and generated readiness-score change were restored exactly to `origin/main`. In particular, `discord:official-picks` remains excluded from replay under the first-release policy.

No schema, migration, dependency, endpoint, presentation, kill-switch state, outbox row, containment state, or production data was changed. Runtime probes were read-only and failed closed.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1728
Execution SHA: 1a210d1a26412eb2f3b35e34429bd5d3fdc7328e
