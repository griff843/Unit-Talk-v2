# UTV2-1560 — Diff Summary

MERGE_SHA: 5546c7324415fff7feb2c574bdc583c899a4b2c9

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

**Known deferred gap:** the new test file is not yet wired into `test:ops`
in `package.json`. That single line is genuinely locked by two other active
lanes (UTV2-1550, UTV2-1554) that also append to it, and UTV2-1550 cannot
currently reach `done` (a separate, unrelated CI-evaluation limitation, not
a defect in this lane). Wiring it in is a one-line follow-up once one of
those lanes clears; until then the test still runs directly
(`npx tsx --test scripts/ops/worker-recovery-workflow.test.ts`, 13/13 pass)
but is not part of the aggregate `pnpm test`/`pnpm verify` run.

## PM verdict fixes (2026-07-21, this revision)

- Two Codex P2 findings fixed in `ops-worker-recovery.yml`: the manual
  `confirm` input is now passed through `env:` and compared as a shell
  variable (never interpolated directly into the run script, closing a
  shell-injection path); the embedded Python one-liner's `d.get("targets")`
  had unescaped inner quotes that the outer local double-quoted `ssh`
  argument stripped before reaching the remote host (`NameError`, always
  failing target verification post-restart) -- now escaped consistently
  with the rest of the script. Both covered by new/updated regression tests.
- Removed the `package.json` edit (see deferred-gap note above) rather than
  force a cross-lane conflict with UTV2-1550/UTV2-1554's own locks on that
  same line.

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
