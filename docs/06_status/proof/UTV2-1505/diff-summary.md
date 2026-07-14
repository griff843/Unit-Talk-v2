# UTV2-1505 Diff Summary

## Summary

Adds the QA Red-Team Agent Charter: a bounded, evidence-led operating contract
for independent adversarial verification of Unit Talk changes.

## Changes

- `docs/05_operations/QA_RED_TEAM_AGENT_CHARTER.md` defines the agent's
  purpose, authority limits, adversarial testing posture, method, finding
  severity, escalation rules, and evidence standard.
- The charter explicitly prevents the QA role from approving, merging,
  deploying, mutating production data, widening scope, or treating missing
  evidence as a pass.

## Scope

Documentation and UTV2-1505 proof artifacts only. No runtime code, database
schema, contracts, or production configuration changed.

## Verification plan

- `pnpm type-check`
- `pnpm test`
- charter structure and required guardrail checks
- `pnpm verify`
- R-level check against `origin/main`
