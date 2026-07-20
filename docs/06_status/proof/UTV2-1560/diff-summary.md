# UTV2-1560 — Diff Summary

MERGE_SHA: PLACEHOLDER_REBIND_BEFORE_COMMIT

## Scope

Continuation of the network-diagnose hardening + narrow worker-only recovery
workflow. Carries forward the accepted substance of PR #1258 (frozen at the
bounce limit — 4 CHANGES_REQUIRED verdicts — per PM direction to open a
clean continuation instead of continuing to iterate on that PR), rebased
onto current main.

## Files changed

- `.github/workflows/ops-network-diagnose.yml` — hardening already accepted
  across PR #1258's review rounds: robust DB/pooler key discovery (pattern
  match with a documented legacy fallback, not a fixed name list), and a
  curl-or-node HTTPS reachability fallback for the worker container probe
  (unauthenticated GET only, no production credentials ever used).
- `.github/workflows/ops-worker-recovery.yml` — new, manual-dispatch-only,
  narrow worker-only recovery workflow.
- `scripts/ops/worker-recovery-workflow.test.ts` — regression tests for the
  recovery workflow's structure and safety properties.
- `package.json` — wires the new test file into `test:ops`.

## Why a continuation PR, not a rebase of #1258

#1258 hit the T1 bounce limit (3+ CHANGES_REQUIRED verdicts trips
`merge-gate-verdict.cjs`'s bounce-limit check). Per PM direction, frozen and
closed without merging; this PR carries the exact same, already-reviewed
file content forward from current main rather than continuing to iterate on
the bounce-limited PR.

## Safety

No API restart, deploy, or environment mutation anywhere in either workflow.
Every diagnostic command is inspect/logs/events/curl-GET-only. The recovery
workflow itself is `workflow_dispatch`-only — this PR does not invoke it.
