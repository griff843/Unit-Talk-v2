# UTV2-1561 — Diff Summary

MERGE_SHA: PLACEHOLDER_REBIND_BEFORE_COMMIT

## Scope

Continuation of PR #1259 (frozen at the T1 bounce limit per PM direction),
carrying forward the exact same already-reviewed read-only container
restart-history diagnostic workflow content, rebased onto current main.

## Files changed

- `.github/workflows/ops-container-diagnose.yml` — read-only diagnostic
  workflow: container creation time, restart count/policy, image/deployed
  SHA, full `.State` history, health-check status, Docker daemon events
  (container-scoped and die/oom/restart/health_status-scoped, 7-day
  window, generated Unix timestamps not the unsupported `now` literal),
  host kernel/OOM events (journalctl -k, dmesg fallback) and Docker daemon
  service log, host reboot history, CPU/memory/disk pressure.

## Why a continuation PR, not a rebase of #1259

#1259 hit the T1 bounce limit (5 CHANGES_REQUIRED verdicts). Per PM
direction, frozen and closed without merging; this PR carries the exact
same, already-reviewed file content forward from current main rather than
continuing to iterate on the bounce-limited PR.

## Safety

No API restart, deploy, or environment mutation anywhere in the workflow.
Every command is inspect/logs/events/journalctl/df/free/stats. Each
docker-events / journalctl / dmesg collection command captures its own
exit code and prints an explicit FAILED marker distinct from a genuine
zero-matches result (a fix accepted during #1259's review rounds).
