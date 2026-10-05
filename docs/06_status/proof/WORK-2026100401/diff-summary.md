# Diff summary: WORK-2026100401

This lane repairs only the Shadow parity runner's `settledResultBacked` observation and its
deterministic regression suite. It does not change Discord product code, settlement writes,
schema, application services, workflows, credentials, RLS, or runtime routing.

| File                                     | Change                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/shadow-scoring-runner.ts`       | Replaces the nonexistent `pick_candidates.outcome` count with paginated candidate links followed by a paginated `settlement_records -> picks` FK read. Applies canonical result, evidence, settlement status, submission, void, shadow-source, and fixture exclusions and counts each qualifying candidate once. |
| `scripts/shadow-scoring-runner.test.ts`  | Adds deterministic real-shape coverage for win/loss/push, incomplete evidence, missing settlements, void/shadow/fixture/non-production picks, duplicate and correction rows, pagination, query shape, query errors, and absent data. Existing zero-scan and guardrail tests remain.                              |
| `docs/06_status/proof/WORK-2026100401/*` | Records canonical schema/query, read-only grant, static verification, local staging refusal, and post-merge trusted-base dependencies.                                                                                                                                                                           |

## Containment

- Production writes made by this implementation: **0**.
- Grant change already captured by the sanctioned read-only probe: `SELECT` only on
  `public.picks` and `public.settlement_records` for `shadow_parity_reader`.
- Measured writable application-data relations for that role after the grant: **0**.
- Workflow changes: **none**.
- PR 1714 files or Discord implementation changes: **none**.

## SHA Binding

Implementation SHA: `7240093fc6c610cb16355aeb313fb1b4d102142a`

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1715
