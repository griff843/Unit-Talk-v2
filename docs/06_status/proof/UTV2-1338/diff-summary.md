# Diff Summary — UTV2-1338 Incident Runbook

## What Was Added

This lane adds a new operational incident runbook for Unit Talk V2 production. All changes are docs-only — no source code, tests, migrations, or configuration was modified.

### New Files

| File | Description |
|------|-------------|
| `docs/06_status/proof/UTV2-1338/INCIDENT_RUNBOOK.md` | Primary operational runbook covering 6 incident classes |
| `docs/06_status/proof/UTV2-1338/verification.md` | Verification log with pnpm verify, test, type-check, r-level-check results |
| `docs/06_status/proof/UTV2-1338/diff-summary.md` | This file |

## Runbook Coverage

The `INCIDENT_RUNBOOK.md` covers the following 6 incident classes, each grounded in actual codebase patterns:

1. **Ingestor Not Cycling** — Based on `apps/ingestor/src/index.ts` watchdog logic, `UNIT_TALK_INGESTOR_MAX_CYCLES` behavior (UTV2-1293 fix), and `scripts/ingestor-alert-check.ts`. Covers watchdog fires, container restarts, orphaned `ingestor.cycle` system_runs, and SGO key issues as sub-causes.

2. **DB Timeout** — Based on the statement_timeout pattern confirmed in UTV2-1315 (`markClosingLines` snapshot_at lower-bound fix), UTV2-1294 (oversized archive write timeout), and UTV2-1290/1292 (`system_runs` bloat). Covers partition scan detection, bloat diagnosis, and mitigation steps.

3. **Settlement / Grading Failure** — Based on `apps/api/src/grading-service.ts` skip reasons (all sourced from actual code: `event_provenance_untrusted_provider`, `game_result_not_found`, `event_not_completed`, etc.), `atomicClaimForTransition` double-settlement protection, and `system_runs` `grading.run` tracking.

4. **Deploy Failure** — Based on `.github/workflows/deploy.yml` pipeline structure (verify → rollback-dry-run → build → canary → promote → smoke), `deploy/rollback.sh` rollback path, `.unit-talk-release` tag tracking, and the env-rewrite pattern (secrets via printf, not persisted on server).

5. **Provider Key / API Issue (SGO)** — Based on `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` SGO rate limits (50k req/hr, 300k objects/hr, 7M objects/day), `SGO_API_KEY_FALLBACK` config, `UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true` mitigation, and `includeAltLines=false` permanent disable (UTV2-1266).

6. **Supabase Degraded** — Based on `apps/ingestor/src/circuit-breaker.ts` circuit breaker presence, `archive-payload-guard.ts` write size protection, fail-closed runtime mode (`UNIT_TALK_*_RUNTIME_MODE=fail_closed`), and the PostgREST timeout pattern from UTV2-1294.

## No Source Code Changes

This is a pure documentation lane. The file scope lock (`docs/06_status/proof/UTV2-1338/`) was respected in full. No test files, source files, migrations, or configuration files were created or modified.

## Merge SHA

468cd83b4b9100ab8d03c8c101d308aec20f1f39
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1100
**Merged:** 2026-06-28
