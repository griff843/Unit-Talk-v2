# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> Operational work queue: Linear live state.
> Historical record: `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-05-20 — PM topology decision recorded; 7-lane parallel infrastructure sprint underway.

- **PM Decision (2026-05-20):** Single-node Hetzner at 46.225.14.123 is the authoritative production target. Multi-server topology (EX44/CCX23/BX11) deferred to future scale milestone.
- Single node provisioned and services deployed (last deploy 2026-05-17, SHA `bd952fd7`).
- 7 active infra lanes in parallel push toward runtime truth + 72h burn-in.
- Runtime readiness: NOT READY — burn-in not complete, ingestor freshness failing.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 - sports betting pick lifecycle platform |
| Active operating mode | Phase 7A — Governance Brake active |
| Static baseline | `pnpm verify` PASS |
| Repo health | `pnpm ops:health` HEALTHY |
| Hetzner node | Single node at 46.225.14.123 — provisioned, services deployed |
| Last deploy SHA | `bd952fd7` (2026-05-17) |
| Services deployed | api, worker, ingestor, discord-bot (docker-compose via GHCR) |
| Active Codex lanes | 4 (infrastructure sprint) |
| Active Claude lanes | 3 (infrastructure sprint) |
| Runtime readiness | NOT READY — burn-in not complete |
| Ingestor freshness | FAILING — root cause identified, fix in UTV2-1014 |

---

## Topology Decision

**2026-05-20 PM Decision:** Single-node Hetzner deployment at 46.225.14.123 is the authoritative production target. Multi-server topology (EX44 primary / CCX23 DB / BX11 monitoring) is deferred to a future scale/resilience milestone when current scale justifies it. This decision unblocks UTV2-1013 and all downstream runtime readiness work.

---

## Active Work Queue

| Priority | Issue | Status | Notes |
|---:|---|---|---|
| 1 | UTV2-1014 | In Progress | Fix .env.production delivery + SSH operator key access |
| 2 | UTV2-1015 | In Progress | Loki + Grafana centralized logging deploy |
| 3 | UTV2-1016 | In Progress | Uptime Kuma full 5-monitor setup (1/5 configured) |
| 4 | UTV2-1031 | In Progress | Live rollback drill — not yet executed |
| 5 | UTV2-1041 | In Progress | 72h burn-in evidence collection — blocked on above |
| 6 | UTV2-1012 | In Progress | Supervisor verification |
| 7 | UTV2-1013 | Done (this lane) | PM decision recorded — single-node topology confirmed |

---

## Recently Closed (since 2026-05-14)

| Issue / PR | Result | Merged SHA |
|---|---|---|
| PR #672 — workflow audit hardening | Merged 2026-05-15 | `f119c156` |
| UTV2-910 — ingestor cadence fix (T1) | Merged 2026-05-15, PR #686 | `8b16ed4c` |
| UTV2-952 — /health UUID probe fix (T2) | Done 2026-05-15 | — |
| UTV2-954 — alert runtime validator (T2) | Merged 2026-05-15, PR #687 | `b9799398` |
| UTV2-955 — lane taxonomy docs (T3) | Merged 2026-05-15, PR #677 | `43a6b7a8` |
| UTV2-958 — proof bundle standard (T3) | Merged 2026-05-15, PR #678 | `955f7fc9` |
| UTV2-962 — registry reconciliation (T3) | Merged 2026-05-15, PR #683 | `5071e807` |
| UTV2-969 — execution packet generator (T2) | Merged 2026-05-16, PR #688 | `20ccfc51` |
| UTV2-970 — manifest housekeeping CI policy (T3) | Merged 2026-05-15, PR #682 | `6df8a8c9` |
| UTV2-971 — PR review packets (T2) | Merged 2026-05-16, PR #690 | `7c9244f9` |
| UTV2-973 — merge-risk analysis (T2) | Merged 2026-05-16, PR #689 | `3101d890` |
| UTV2-974 — execution-state observability (T2) | Merged 2026-05-16, PR #691 | `849b14ee` |
| UTV2-976 — ops:reconcile stranded lanes (T3) | Merged 2026-05-15 | `b4f045fe` |
| UTV2-977 — tier-c-path-guard shell fallback (T3) | Merged 2026-05-15, PR #684 | `3fca5c4c` |

---

## Readiness Gates

| Gate | Status | Current Truth |
|---|---|---|
| Repo hygiene | Green | `ops:health` HEALTHY |
| Lane registry | Green | All lanes tracked |
| Working tree | Green | Clean — all changes committed |
| Hetzner node | Green | Single node at 46.225.14.123 provisioned; services deployed 2026-05-17 SHA `bd952fd7` |
| Ingestor freshness | Red | Staleness alert failing — root cause identified, fix in UTV2-1014 |
| Centralized logging | Red | Loki not yet deployed — UTV2-1015 in progress |
| Monitoring completeness | Amber | 1/5 Uptime Kuma monitors configured — UTV2-1016 in progress |
| Rollback drill | Red | Not executed — UTV2-1031 in progress |
| 72h burn-in | Not Started | Blocked on ingestor freshness, logging, monitoring, rollback drill |

---

## Open Risks

| Risk | Severity | Status / Action |
|---|---:|---|
| Ingestor freshness failing | High | .env.production delivery broken; UTV2-1014 in progress |
| No local SSH operator key | High | Ops-add-operator-key workflow being built in UTV2-1014 |
| 72h burn-in not started | High | Blocked on UTV2-1014, UTV2-1015, UTV2-1016, UTV2-1031 |
| Uptime Kuma incomplete | Medium | 4/5 monitors unconfigured — UTV2-1016 in progress |
| Loki not deployed | Medium | No centralized log aggregation until UTV2-1015 closes |
| Rollback drill not executed | Medium | Production readiness gate; UTV2-1031 in progress |
| Runtime proof gap | High | Static verify is not runtime readiness; do not conflate |

---

## Next PM Actions

1. Monitor 7-lane infra sprint: UTV2-1014 is the critical-path unblock for ingestor freshness and SSH access.
2. 72h burn-in (UTV2-1041) cannot start until UTV2-1014, UTV2-1015, UTV2-1016, and UTV2-1031 all close.
3. No production runtime assertion until burn-in completes and runtime proof is assembled.

---

## Authority References

| Purpose | File / System |
|---|---|
| Active program status | `docs/06_status/PROGRAM_STATUS.md` |
| Current repo snapshot | `docs/06_status/SYSTEM_STATE.md` |
| Historical record | `docs/06_status/PROGRAM_STATUS_ARCHIVE.md` |
| Operational work queue | Linear |
| PR/source truth | GitHub |

---

## Update Rule

Update this file at T1/T2 sprint close, workflow/governance closeout, or whenever GitHub/Linear status would otherwise tell a materially different story.
