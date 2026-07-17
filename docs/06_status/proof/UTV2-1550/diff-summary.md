# UTV2-1550 Diff Summary

Issue: UTV2-1550
Tier: T1
Lane type: governance
Branch: claude/utv2-1550-executor-result-required-check-identity
Head SHA: bbd7d2b098648a9935bb96d8c2c21d21357dff3e
Diff base: origin/main

## Files changed

- `.github/workflows/executor-result-validator.yml` — pull_request-triggered evaluation now always uses a distinct, non-required check name ("Executor Result Preflight"); only issue_comment/workflow_dispatch create the required "Executor Result Validation" context, resolved via the tested CLI rather than a hardcoded literal. Adds workflow_dispatch recovery trigger.
- `scripts/ops/executor-result-validate.ts` (new) — pure, testable check-name resolution and field-level comment validation, plus a CLI entrypoint the workflow calls.
- `scripts/ops/executor-result-validate.test.ts` (new) — 21 tests covering missing/valid/corrected results and the exact head-change scenario that caused the incident.
- `scripts/ops/workflow-hardening.test.ts` — updated the assertion that required `executor-result-validator.yml`'s job.name to literally equal the required check name (which would have let the job's own native per-job check recreate the bug); added a dedicated test for the new dynamic-name design.
- `docs/06_status/INCIDENTS/INC-2026-07-17-utv2-1550-stale-required-check-identity.md` (new) — root cause, why the investigation took as long as it did, permanent fix, temporary recovery procedure, recurrence prevention.

## Explicitly not changed

- No branch-protection or repository ruleset setting.
- No required-status-check context removed or renamed at the branch-protection level — "Executor Result Validation" remains required, exactly as before; only which trigger is permitted to create it changed.
- No other workflow file.
