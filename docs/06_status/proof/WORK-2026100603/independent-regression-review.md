# Independent executor regression review

These are isolated temporary Git/checkpoint fixtures, not runtime execution or production attestations. The fixture scripts live in /tmp/work-2026100603-{assigned-self-proof,rework-authority}-fixed-repro.ts and import the current lane evaluator directly.

Both executed with pnpm exec tsx and exited 0 after confirming FAIL_CLOSED. Assigned own artifacts/** report: IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE, source=0, evidence=0. Rejected-HEAD scope/task-contract injection: REWORK_NO_SOURCE_CHANGE, source=0, evidence=0.

Evaluator SHA256 before and after first reproduction: 5f1b84ae939c14dd5b9ecfb98a641efb5da0dcb2afd7911066daae91a1bdf290. Permanent coverage belongs in the scoped codex-exec test suite. These results do not replace full verify, writable staging, T1 staging, or actual outer executor attestation.
