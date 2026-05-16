# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> Operational work queue: Linear live state.
> Historical record: `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-05-16 — board cleared after high-velocity lane close sprint (14 issues merged since 2026-05-14 status).

- Repo health is GREEN: `pnpm ops:health` reports HEALTHY after lane manifest reconciliation.
- Board is clean: 0 active lanes, 0 stale manifests, 0 missing `closed_at`.
- Working tree is clean: all docs and proof artifacts committed.
- Only UTV2-770 (Hetzner cutover gate) remains open — blocked by `needs:hetzner`.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 - sports betting pick lifecycle platform |
| Active operating mode | Phase 7A — Governance Brake active |
| Static baseline | `pnpm verify` PASS |
| Repo health | `pnpm ops:health` HEALTHY |
| Active Codex lanes | none |
| Active Claude lanes | none |
| Active worktrees | 1 — `C:/Dev/Unit-Talk-v2-main` (main checkout) |
| Local branches | `main` only |
| Open PRs | none |

---

## Active Work Queue

| Priority | Issue | Status | Notes |
|---:|---|---|---|
| 1 | UTV2-770 | In Claude | Hetzner cutover gate; blocked by `needs:hetzner`; ingestion freshness proof required before production |

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
| Lane registry | Green | 0 active lanes, 0 stale, 0 missing `closed_at` |
| Working tree | Green | Clean — all changes committed |
| Runtime readiness | Not asserted | Static verify does not equal runtime proof |
| MLB production-readiness | Open | Data/proof gated; separate from hygiene work |
| Hetzner cutover | Open | UTV2-770 in Claude; ingestion freshness proof still required |

---

## Open Risks

| Risk | Severity | Status / Action |
|---|---:|---|
| UTV2-770 blocked on infra | High | Needs Hetzner provisioning before cutover gate can close |
| Runtime proof gap | High | Static verify is not runtime readiness; do not conflate |
| Deferred outbox rows | Medium | 6 deferred pending rows outside worker targets; not stuck |

---

## Next PM Actions

1. Resolve UTV2-770: provide Hetzner access or re-scope ingestion freshness proof path.
2. Monitor outbox deferred rows — 6 rows outside worker targets (oldest ~283h).
3. Queue next sprint once UTV2-770 is unblocked or a scope decision is made.

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
