# UTV2-1560 — Diff Summary

MERGE_SHA: 8f8cf3a575b9ad179b2e07b9283f086e11f50a72

(This is the reviewed-implementation content commit, an ancestor of this
branch's actual head — a file cannot bind its own future hash once further
proof-doc commits land on top of it, per this repo's established
convention.)

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
- `package.json` — `test:ops` now includes
  `scripts/ops/worker-recovery-workflow.test.ts`, so the new test runs as
  part of the aggregate `pnpm test`/`pnpm verify` run, not just standalone.
  The two lanes that previously held a conflicting lock on this same line
  (UTV2-1550, UTV2-1554) are both `done`/merged as of this revision, so the
  cross-lane conflict that deferred this wiring no longer applies.

## PM verdict fixes (2026-07-21, this revision)

- Two Codex P2 findings fixed in `ops-worker-recovery.yml`: the manual
  `confirm` input is now passed through `env:` and compared as a shell
  variable (never interpolated directly into the run script, closing a
  shell-injection path); the embedded Python one-liner's `d.get("targets")`
  had unescaped inner quotes that the outer local double-quoted `ssh`
  argument stripped before reaching the remote host (`NameError`, always
  failing target verification post-restart) -- now escaped consistently
  with the rest of the script. Both covered by new/updated regression tests.
- `test:ops` wiring restored (see Files changed above) — the earlier
  cross-lane conflict has cleared.

## PM verdict fixes (2026-07-21, latest revision — RestartCount defect)

- A live Codex P2 finding held that verifying a successful manual restart by
  checking `RestartCount` advanced by exactly 1 is unreliable: Docker's
  `RestartCount` only reflects restarts performed by the container's own
  restart policy (e.g. `on-failure`/`always`) — it does **not** increment for
  an operator-initiated `docker restart` invocation, which is exactly what
  this workflow performs. Gating success on it would fail closed on every
  legitimate manual recovery.
- Fixed by replacing the gating check with the container's
  `.State.StartedAt` timestamp: Docker sets this every time the container's
  process actually starts, whether the restart was manual or
  policy-triggered, making it a reliable, restart-cause-agnostic signal.
  The workflow now captures `PRE_STARTED_AT`/`POST_STARTED_AT` and requires
  both to be non-empty and unequal for PASS. `RestartCount` is still
  captured and logged for audit purposes but no longer gates PASS/FAIL.
  Regression test updated accordingly (13/13 still pass).

## Known non-blocking gaps (outside this PR's mechanical reach)

- **File Scope Lock** (advisory, not in `main`'s required status checks):
  fails because `docs/06_status/lanes/UTV2-1560.json` on `main` is a ghost
  manifest left over from PR #1256 (merged, but the manifest's `status` was
  never advanced past `"started"` and its `branch` field still names the
  original `claude/utv2-1560-hetzner-supabase-502-diagnosis` branch). The
  file-scope guard trusts the base-branch (`main`) copy of any manifest path
  that already exists there — a PR cannot rewrite its own manifest's
  authority over paths that predate it on `main`. Fixing this requires a
  `main`-side `ops:lane-close --repair-merged` reconciliation of that ghost
  manifest, which is out of scope for a lane branch's own diff and outside
  this session's permitted scope (no direct-main changes). A previously
  issued `scope-override/v1` comment resolved this for an earlier head, but
  per schema rule 5 an override is bound to one exact head SHA and does not
  carry forward to a new commit.
- **Readiness Regression Gate** (advisory, not in `main`'s required status
  checks): fails on a repo-wide, pre-existing `readiness-score.json` ledger
  (126h stale, verdict RED) unrelated to any file this lane touches.

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
