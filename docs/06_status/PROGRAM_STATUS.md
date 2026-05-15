# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> Operational work queue: Linear live state.
> Historical record: `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-05-14 23:05 EDT - repo hygiene and workflow audit hardening closed into draft PR #672.

- Repo health is GREEN: `pnpm ops:health` reports `HEALTHY`.
- Git hygiene is clean: only one worktree remains, local branch set is reduced to `main` and `codex/workflow-audit-hardening`, and the working directory was clean before this status-doc refresh.
- Lane registry is clean: 147 lane manifests, 0 active lanes, 0 stale lanes, 0 missing `closed_at`.
- Draft PR #672 is open for workflow audit hardening and carries `tier:T3`.
- PR #672 local verification passed: `pnpm verify`, pre-push `pnpm verify`, and R-level check all passed.
- PR #672 is still merge-blocked by sync-metadata enforcement checks because the hygiene lane does not map to a normal Linear implementation issue.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 - sports betting pick lifecycle platform |
| Active operating mode | Governance Brake active; workflow hygiene closeout in review |
| Static baseline | `pnpm verify` PASS locally and in pre-push hook for PR #672 |
| Repo health | `pnpm ops:health` HEALTHY |
| Active Codex lanes | none in canonical lane manifests |
| Active worktree count | 1 - `C:/Dev/Unit-Talk-v2-main` |
| Local branches | `main`, `codex/workflow-audit-hardening` |
| Open closeout PR | #672 - `[codex] workflow audit hardening` |
| PR #672 state | Draft; `tier:T3`; merge blocked by sync metadata checks |
| Phase | Phase 7A - Governance Brake active |

---

## Active Work Queue

Live queue truth from `pnpm ops:brief`:

| Priority | Issue | Status | Notes |
|---:|---|---|---|
| 1 | UTV2-910 | Ready for Codex | T1 ingestor cadence break; one-shot bridge leaves offer data stale |
| 2 | UTV2-952 | In Codex | T2 flaky `/health` UUID probe returns 503 in database persistence mode |
| 3 | UTV2-954 | In Codex | T2 alert-agent validator integration P0 follow-up |
| 4 | UTV2-770 | In Claude | Hetzner cutover gate; ingestion freshness must be proven before production |
| 5 | PR #672 | Draft PR | Workflow audit hardening closeout; needs sync-metadata decision before merge |

---

## Recently Closed / Merged / Cleaned

| Item | Result |
|---|---|
| PR #672 | Open draft with workflow audit hardening, private agent notifications, lane scoreboard, and stale lane reconciliation |
| Local branch cleanup | 525 stale local branches deleted after safety bundle creation |
| Worktree cleanup | Git worktree registry reduced to the main checkout only |
| Lane reconciliation | 0 active lanes, 0 stale lanes, 0 missing `closed_at` |
| Safety backup | Local refs bundle created at `C:\Dev\unit-talk-local-refs-backup-20260514-194454.bundle` |

---

## Readiness Gates

| Gate | Status | Current Truth |
|---|---|---|
| Repo hygiene | Green | `ops:health` HEALTHY |
| Lane registry | Green | No active/stale/missing-close lane manifests |
| PR #672 mergeability | Blocked | Sync-metadata checks require a decision for non-Linear hygiene work |
| Runtime readiness | Not asserted by this status update | Static verify does not equal runtime proof |
| MLB production-readiness | Open | Still data/proof gated; do not close from this hygiene work |
| Hetzner cutover | Open | UTV2-770 remains in Claude; ingestion freshness proof still required |

---

## Open Risks

| Risk | Severity | Status / Action |
|---|---:|---|
| PR #672 sync metadata gate | Medium | Decide whether to attach a Linear hygiene issue, add approved bypass metadata, or keep PR as a manual governance exception |
| Status drift | Medium | This file is now refreshed, but Linear remains the operational queue authority |
| Runtime proof confusion | High | Do not treat `pnpm verify` or repo health as worker/API/DB runtime readiness |
| Deferred outbox rows | Medium | `ops:brief` reports 6 deferred pending rows outside worker targets; not stuck, but worth tracking |
| Old quarantine folder | Low | External folder deletion may still be draining under `C:\Dev\unit-talk-worktree-trash-20260514-2038`; it is outside repo health |

---

## Next PM Actions

1. Resolve PR #672 sync-metadata policy: attach a Linear issue, add an approved bypass, or explicitly accept a governance exception.
2. If PR #672 is accepted, mark it ready for review and merge after checks are green.
3. Dispatch or re-triage UTV2-910 next; it is the highest-priority ready Codex item in the brief.
4. Keep UTV2-770 with Claude until ingestion freshness proof is complete.
5. Continue to treat runtime proof separately from static repo health.

---

## Authority References

| Purpose | File / System |
|---|---|
| Active program status | `docs/06_status/PROGRAM_STATUS.md` |
| Current repo snapshot | `docs/06_status/SYSTEM_STATE.md` |
| Historical record | `docs/06_status/PROGRAM_STATUS_ARCHIVE.md` |
| Operational work queue | Linear |
| PR/source truth | GitHub |
| Lifecycle truth | `docs/ai_context/v2_truth_pack` and current lifecycle proof docs |

---

## Update Rule

Update this file at T1/T2 sprint close, workflow/governance closeout, or whenever GitHub/Linear status would otherwise tell a materially different story.
