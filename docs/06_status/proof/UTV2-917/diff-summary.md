# UTV2-917 Diff Summary

## Summary

- Added a shared queue-health evaluator in `@unit-talk/observability` for pending age, pending by target, failed/dead-letter counts, last successful delivery age, and target mismatch alerts.
- Exposed queue health through `/health`, including unhealthy status and queue metrics when a runtime snapshot is provided.
- Updated worker runner observability hooks and `scripts/pipeline-health.ts` so queue breaches produce alert output and a failing script exit for critical queue health.

## Verification

- `pnpm exec tsx --test packages/observability/src/index.test.ts apps/api/src/server.test.ts`
- `pnpm lint`
- `pnpm type-check`
- `pnpm verify`

Full verification output is captured in `docs/06_status/proof/UTV2-917/verification.log`.
