# Diff Summary — UTV2-1013

**Lane:** UTV2-1013 — Record single-node topology PM decision  
**Type:** Documentation only — no code changes  
**Date:** 2026-05-20

---

## PM Decision Recorded

| Decision | Value |
|---|---|
| Production topology | Single-node Hetzner at 46.225.14.123 |
| Multi-server topology (EX44/CCX23/BX11) | Deferred to future scale milestone |
| Decision date | 2026-05-20 |
| Unblocks | UTV2-1013 and all downstream runtime readiness lanes |

---

## Files Updated

| File | Change |
|---|---|
| `docs/06_status/PROGRAM_STATUS.md` | Updated Last Updated, Current State, Topology Decision section, Active Work Queue (7 infra lanes), Readiness Gates, Open Risks, Next PM Actions |
| `docs/05_operations/HETZNER_PROVISIONING_CHECKLIST.md` | Added 2026-05-20 topology decision note at top; updated Architecture baseline to show single-node active + multi-server deferred |
| `docs/06_status/proof/UTV2-1013/diff-summary.md` | NEW — this file |
| `docs/06_status/proof/UTV2-1013/verification.md` | NEW — evidence table |

---

## GitHub Actions Evidence

| Run | Description | URL |
|---|---|---|
| 25997310423 | Deploy run — 2026-05-17T17:09:18Z, SHA `bd952fd7`, all services deployed | https://github.com/Unit-Talk/Unit-Talk-v2/actions/runs/25997310423 |
| 26002834910 | Monitoring run — 2026-05-17T21:11:32Z, Uptime Kuma deployed, cron jobs installed | https://github.com/Unit-Talk/Unit-Talk-v2/actions/runs/26002834910 |

---

## Infrastructure Evidence Summary

| Item | Value |
|---|---|
| Node IP | 46.225.14.123 |
| SSH fingerprint | OpenSSH 9.6p1 Ubuntu (confirmed via ssh-keyscan) |
| Last deploy SHA | `bd952fd7211d92eab782da273f11fa386dc22ca0` |
| Last deploy timestamp | 2026-05-17T17:09:18Z |
| Services deployed | api, worker, ingestor, discord-bot |
| Image registry | GHCR |
| Post-deploy smoke test | PASS (DB reachable, runtime mode fail_closed, queue health OK) |
| .unit-talk-release on server | Written with SHA `bd952fd7` |
| Uptime Kuma | Deployed; 1/5 monitors configured (API health only) |
| Cron jobs installed | container-health-watch (every 2 min), disk-alert (every hour) |
