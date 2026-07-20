# PROOF: UTV2-1561

MERGE_SHA: PLACEHOLDER_REBIND_BEFORE_COMMIT

## Summary

Continuation of PR #1259 (frozen at the T1 bounce limit per PM direction),
carrying forward the exact same already-reviewed read-only container
restart-history diagnostic workflow on a fresh branch from current main.
No new implementation changes.

## ASSERTIONS:

- [x] Captures exact container creation time, restart count, restart policy, image/deployed SHA
- [x] Captures full `.State` history (Status/ExitCode/OOMKilled/Error/StartedAt/FinishedAt)
- [x] Captures health-check status and recent health log
- [x] Captures Docker daemon events (container-scoped and die/oom/restart/health_status-scoped, 7-day window, generated Unix timestamps)
- [x] Captures host kernel/OOM events (journalctl -k, dmesg fallback) and Docker daemon service log
- [x] Captures host reboot history (last reboot, who -b)
- [x] Captures CPU/memory/disk pressure (free, df, docker stats, /proc/loadavg, /proc/pressure/*)
- [x] No API restart, deploy, or env mutation anywhere in the workflow
- [x] Each collection command distinguishes a genuine command failure from a zero-matches result
- [x] `pnpm test:db` PASS (see EVIDENCE below)

## EVIDENCE:

```text
$ pnpm test:db
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm type-check
(clean, no errors)
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) -- no R-level artifacts required for this diff
```

## Known gaps

- The Docker daemon events window (`--since 168h`) covers 7 days; older
  individual events may have rotated out of the daemon's event log.
  `RestartCount` and `.State` still report the current lifetime total
  regardless.
- `journalctl`/`dmesg` output depends on the deploy user's host
  permissions; the workflow reports unavailability rather than failing.
- Deploy-timestamp correlation is done at the analysis layer against
  `gh run list` history, not inside the SSH probe itself.

## Owner boundary

T1 — production investigation. Requires the `t1-approved` label and a
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head
before merge. This proof supplies neither.
