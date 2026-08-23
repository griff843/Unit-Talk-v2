# UTV2-1734 Diff Summary

MERGE_SHA: pending

## Summary

- Captures the authoritative Linear issue snapshot into `.ops/sync/UTV2-1734.yml` with an integrity-bound task contract.
- Renders the same objective, acceptance criteria, guardrails, non-goals, required evidence, and exit criteria in both Claude and Codex executor prompts.
- Makes the sanctioned executor entry points fail closed with structured `EXECUTION_PACKET_INVALID` output when the contract is absent or invalid.
- Preserves pre-contract lane compatibility by capturing and persisting one contract at executor dispatch time, without a bulk metadata migration.
- Sends the Linear authorization header to curl through stdin configuration so the credential is absent from child-process arguments.

## Tests changed

- `execution-packet.test.ts`: contract extraction, deterministic rendering, integrity failure, missing-contract refusal, and legacy fallback.
- `claude-exec.test.ts` and `codex-exec.test.ts`: shared contract rendering plus behavioral JSON/nonzero/no-continuation inversions at each executor boundary.
- `lane-start.test.ts`: credential non-disclosure and legacy capture-to-persistence-to-render dispatch coverage.

## Scope

No checkpoint epoch semantics, workflow policy, bulk sync migration, database schema, lifecycle, promotion, or delivery behavior changed.
