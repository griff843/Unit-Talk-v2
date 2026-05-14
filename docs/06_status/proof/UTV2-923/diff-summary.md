# UTV2-923 Diff Summary

## Runtime Truth Surface

- Added a shared runtime truth serializer in `packages/observability/src/index.ts` with recursive production redaction, normalized worker targets, compact startup log fields, and tests covering serialization and secret scrubbing.
- Added authenticated `GET /api/runtime/truth` in `apps/api/src/server.ts`, plus API runtime truth startup logging and tests for operator auth, persistence mode, live targets, and redaction.
- Added worker runtime truth in `apps/worker/src/runtime.ts`, including dry-run, autorun, adapter, target coverage, and real-work reasoning, with production redaction coverage.
- Added ingestor runtime truth to the ingestor runtime summary in `apps/ingestor/src/index.ts`, including provider readiness, scheduler state, persistence mode, and real-work reasoning.
- Added Command Center runtime truth fetch support and surfaced runtime mode, persistence, auth, target, and real-work state on the API health page for authenticated operators.

## Scope Notes

- No schema, generated DB type, lifecycle, settlement, or distribution target activation changes.
- `pnpm test:db` was not required for this T2 issue because no files under `supabase/migrations/**`, `packages/db/**`, or `apps/api/src/**-service.ts` changed.
