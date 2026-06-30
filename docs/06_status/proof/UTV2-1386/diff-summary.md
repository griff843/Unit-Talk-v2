# UTV2-1386 Diff Summary

## Summary

- `.github/workflows/deploy.yml` now requires the `SYNDICATE_MACHINE_ENABLED` GitHub secret, validates that it is exactly `true`, writes the deployed env value from the secret instead of a hardcoded fallback, and confirms the running API container reports `SYNDICATE_MACHINE_ENABLED=true` after canary and production deploy steps.
- `apps/api/src/board-scan-service.ts` now exposes `evaluateSyndicateMachineGate()` and emits structured warning/error events when the syndicate machine gate is missing or not true, including a production readiness `red` signal.

## Scope

- Allowed implementation files touched:
  - `.github/workflows/deploy.yml`
  - `apps/api/src/board-scan-service.ts`
- Required proof files added:
  - `docs/06_status/proof/UTV2-1386/diff-summary.md`
  - `docs/06_status/proof/UTV2-1386/verification.md`

## R-Level

`docs/05_operations/r1-r5-rules.json` has no matching rule for `.github/workflows/deploy.yml` or `apps/api/src/board-scan-service.ts`; no R-level artifacts are required.
