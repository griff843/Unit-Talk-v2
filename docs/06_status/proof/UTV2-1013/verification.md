# Verification — UTV2-1013

**Lane:** UTV2-1013 — Record single-node topology PM decision  
**Tier:** T3 (documentation only)  
**Date:** 2026-05-20  
**Executor:** Claude

---

## Evidence Table

| Gate | Status | Evidence |
|---|---|---|
| Single node provisioned | PASS | ssh-keyscan 46.225.14.123 returns OpenSSH 9.6p1 Ubuntu |
| Services deployed | PASS | GHA run 25997310423, 2026-05-17T17:09:18Z — api, worker, ingestor, discord-bot images built and pushed to GHCR |
| Deploy SHA written on server | PASS | .unit-talk-release file contains SHA `bd952fd7211d92eab782da273f11fa386dc22ca0` |
| Post-deploy smoke test | PASS | DB reachable, runtime mode fail_closed, queue health OK (run 25997310423) |
| Uptime Kuma deployed | PASS | GHA run 26002834910, 2026-05-17T21:11:32Z |
| Cron jobs installed | PASS | container-health-watch every 2 min, disk-alert every hour (run 26002834910) |
| Ingestor freshness | FAIL | Staleness alert failing — root cause: .env.production delivery broken; fix in UTV2-1014 |
| Full monitoring | PARTIAL | 1/5 Uptime Kuma monitors configured; remaining 4 are manual steps being fixed in UTV2-1016 |
| SSH operator key | NOT DONE | No local operator key; ops-add-operator-key workflow being built in UTV2-1014 |
| Loki logging | NOT DONE | UTV2-1015 in progress |
| Rollback drill | NOT DONE | UTV2-1031 in progress |
| 72h burn-in | NOT STARTED | Blocked on UTV2-1014, UTV2-1015, UTV2-1016, UTV2-1031 |

---

## PM Decision Evidence

| Field | Value |
|---|---|
| Decision | Single-node Hetzner at 46.225.14.123 is production target |
| Multi-server topology | Deferred to future scale milestone |
| Decision date | 2026-05-20 |
| Recorded in | `docs/06_status/PROGRAM_STATUS.md` — Topology Decision section |
| Checklist updated | `docs/05_operations/HETZNER_PROVISIONING_CHECKLIST.md` — Architecture baseline + top-of-file note |

---

## Linear Issue Recommendation

- Set UTV2-1013 state to **Done**
- Add comment: "PM decision recorded 2026-05-20. Single-node Hetzner at 46.225.14.123 is production target. Multi-server topology deferred. `docs/06_status/PROGRAM_STATUS.md` and `docs/05_operations/HETZNER_PROVISIONING_CHECKLIST.md` updated. Proof at `docs/06_status/proof/UTV2-1013/`."
- Confirm downstream lanes UTV2-1014, UTV2-1015, UTV2-1016, UTV2-1031, UTV2-1041 are unblocked from the topology decision gate.

---

## Open Items (not blocking this lane — tracked in child lanes)

| Item | Blocking Lane |
|---|---|
| .env.production delivery fix | UTV2-1014 |
| SSH operator key | UTV2-1014 |
| Loki + Grafana deploy | UTV2-1015 |
| Uptime Kuma full 5-monitor setup | UTV2-1016 |
| Live rollback drill | UTV2-1031 |
| 72h burn-in | UTV2-1041 |
