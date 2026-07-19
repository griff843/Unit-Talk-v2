# PROOF: UTV2-1561

MERGE_SHA: set-by-ci

## Summary

`unit-talk-api-1` was found to have 314 lifetime restarts (currently healthy,
recreated roughly 5 minutes before inspection at the time of the initial
finding). This was discovered incidentally during UTV2-1477 work but was
outside that lane's granted scope. This lane adds a strictly read-only
diagnostic workflow (`.github/workflows/ops-container-diagnose.yml`) to
capture the full container/daemon/kernel evidence needed to classify the
restart pattern, mirroring the existing `ops-network-diagnose.yml` (UTV2-1560)
and `ops-api-diagnose.yml` patterns already on main.

## ASSERTIONS:

- [x] Captures exact container creation time, restart count, restart policy, image/deployed SHA
- [x] Captures full `.State` history (Status/ExitCode/OOMKilled/Error/StartedAt/FinishedAt)
- [x] Captures health-check status and recent health log
- [x] Captures Docker daemon events (container-scoped and die/oom/restart/health_status-scoped, 7-day window)
- [x] Captures host kernel/OOM events (journalctl -k, dmesg fallback) and Docker daemon service log
- [x] Captures host reboot history (last reboot, who -b)
- [x] Captures CPU/memory/disk pressure (free, df, docker stats, /proc/loadavg, /proc/pressure/*)
- [x] No API restart, deploy, or env mutation anywhere in the workflow -- every command is inspect/logs/events/journalctl/df/free/stats
- [x] Reuses existing `UNIT_TALK_DEPLOY_HOST`/`_USER`/`_PATH`/`_SSH_KEY` secrets; no new secret introduced
- [x] pnpm verify PASS (see EVIDENCE below)
- [x] r-level-check PASS (see EVIDENCE below)

## EVIDENCE:

```text
$ pnpm verify
(exit 0 -- full static gate + live DB smoke + live T1 proof suite)
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Known gaps

- The Docker daemon events window (`--since 168h`) covers 7 days; if the
  314-restart count accumulated over a longer period, older individual
  events will have rotated out of the daemon's event log. `RestartCount`
  and `.State` still report the current lifetime total regardless.
- `journalctl`/`dmesg` output depends on the deploy user's host permissions;
  the workflow reports unavailability rather than failing, so an empty OOM
  section is not proof no OOM event occurred.
- Deploy-timestamp correlation (container `Created` vs. actual `deploy.yml`
  runs) is intentionally done at the analysis layer against `gh run list`
  history after the artifact is downloaded, not inside the SSH probe itself.

## Owner boundary

T1 — production investigation. Requires the `t1-approved` label and a valid
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head
before merge. This proof supplies neither.
