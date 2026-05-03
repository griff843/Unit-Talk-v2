# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> **Operational work queue: Linear (live).**
> **Historical record:** `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-05-01 — **Worker/API hardening Wave 2 dispatched. T1 ops PRs approved. Provider-offer architecture cut over. Command-center pipeline pages merged.**

- **Wave 2 T3 hardening in review:** UTV2-805 (delivery-adapter logging), UTV2-807 (watchdogMs bounds), UTV2-809 (CLV null guard), UTV2-810 (Kelly overFair guard) — PRs #520–#523 all pass `pnpm verify`.
- **T1 ops PRs approved and ready:** PR #514 (UTV2-782 WAL/PITR runbook) + PR #515 (UTV2-789 least-privilege Postgres roles) — both have `t1-approved` labels, awaiting PM merge.
- **Provider-offer architecture cut over:** PR #513 merged (compact architecture + legacy quarantine). UTV2-803 disk-growth incident partially resolved — 7-day retention in place, `provider_offers` at ~7.47 GB but bounded.
- **Command-center UNI pages merged:** UNI-101 (Agents/Intelligence/Ops), UNI-138 (Events live stream), UNI-137 (Pipeline page) all merged to main on 2026-05-01.
- **T1 replay proof shipped:** UTV2-781 freshness-gated scanner + real provider-offer replay proof (PR #507, merged 2026-04-29).
- **UTV2-433 remains open.** MLB production-readiness gate requires fresh post-fix MLB settlements with `clvBackedOutcomeCount >= 10`.
- **Recent completed work since April 26:** UTV2-761 QA trust layer, UTV2-762 Fibery guardrail, UTV2-764 operator-web data layer extract, UTV2-766 command-center DB rewire, UTV2-769 operator-web teardown, UTV2-781 replay proof, UTV2-787/773/774/793/796/797 provider ingestion health.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Active operating mode | Worker/API hardening (Wave 2 T3s) + T1 ops infrastructure merge |
| Static baseline | `pnpm verify` PASS on main; all Wave 2 PRs (#520–#524) verified green |
| Runtime health | Provider-offer architecture cut over; 7-day retention bounded; disk alert reduced but not cleared |
| Provider | SGO Pro active; closing-line truth is `provider_offers WHERE is_closing = true`; `market_universe` is canonical persistence |
| Current active PRs | **#520–#524** — Wave 2 T3 hardening + cleanup (In Review); **#514, #515** — T1 ops (t1-approved, awaiting merge) |
| Current active Linear lanes | UTV2-805, 807, 809, 810 (In Review); UTV2-768 (In Review) |
| Main readiness gate still open | **UTV2-433** — MLB production-readiness gate (needs fresh post-fix settlements) |
| Phase | Phase 7A — Governance Brake active |

---

## Active Work Queue

| Priority | Issue / PR | Status | PM Direction |
|---:|---|---|---|
| 1 | **PR #514 / UTV2-782** | t1-approved, open | WAL/PITR runbook + backup alerts — merge when ready |
| 2 | **PR #515 / UTV2-789** | t1-approved, open | Least-privilege Postgres roles — merge when ready |
| 3 | **PRs #520–#523** | In Review (T3) | Wave 2 worker/API hardening — merge on green |
| 4 | **PR #519 / UTV2-768** | In Review (T3) | Grading alias fix — merge on green |
| 5 | **PR #524** | In Review (T3) | Cleanup wave 1 (worktree-setup + orphaned CC files) |
| 6 | **UTV2-433** | In Progress | Wait for fresh post-fix MLB settlement evidence |
| 7 | **Wave 3 T3 hardening** | Backlog | UTV2-811/812/813 — system-pick-scanner + settlement-service hardening |

---

## Recently Merged / Closed

| PR | Issue | Tier | Result |
|---|---|---|---|
| #518 | UNI-137 | T3 | Command-center pipeline page |
| #517 | UNI-138 | T3 | Command-center events live stream and replay |
| #516 | UNI-101 | T3 | Command-center Agents, Intelligence, and Ops pages |
| #513 | UTV2-803 | T1 | Compact provider-offer architecture cut over; legacy table quarantined |
| #507 | UTV2-781 | T1 | Real provider-offer replay proof + freshness-gated scanner |
| #506 | UTV2-787/773/774/793/796/797 | T2 | Provider ingestion health surfaces |
| #505 | UTV2-769 | T3 | operator-web teardown |
| #504 | UTV2-766 | T3 | Command-center rewired to direct DB (no operator-web) |
| #501 | UTV2-764 | T2 | Operator-web data layer extracted into command-center |
| #496 | UTV2-752 | T2 | Canonical key join + market_universe backfill |
| #493 | — | T2 | Guard ungradeable system picks |
| #492 | UTV2-762 | T3 | Fibery lane-start guardrail |
| #490 | UTV2-761 | T2 | Experience QA trust layer |
| #489 | UTV2-751 | T2 | SGO historical backfill proof; CLV not blocked |

---

## Readiness Gates

| Gate | Status | Current Truth |
|---|---|---|
| NHL production-readiness | ✅ Done | UTV2-435 passed threshold and closed |
| MLB production-readiness | 🔴 Open | UTV2-433 failed previous proof: 3/167 CLV-backed; needs fresh post-fix settlements >=10 CLV-backed |
| Current CLV viability | ✅ Acceptable | UTV2-751 proved existing settled picks are inside current SGO data window |
| Historical SGO completeness | 🟡 Backlog | UTV2-760 tracks pre-April-20 archive-quality backfill; non-blocking |
| QA regression gate | 🟡 In progress | PR #490/UTV2-761 adds trust layer but is not merge-ready |
| Discord bot foundation | ⚪ Ready candidate | Spec exists; defer until QA/status cleanup is landed |

---

## Open Risks

| Risk | Severity | Status / Action |
|---|---:|---|
| PR #490 governance drift | High | `.ops/sync.yml` disables sync and clears entities; must be justified or reverted before merge |
| UTV2-433 fresh proof dependency | High | Need enough fresh MLB settlements from the post-UTV2-754 provenance path |
| Worker/runtime health not independently confirmed | High | Do not equate `pnpm verify` with runtime health |
| Linear umbrella/status drift | Medium | UTV2-739 and UTV2-729 need cleanup after recent completions |
| Fibery entity seeding failures | Medium | Bypass used on UTV2-736/751 due to missing seeded proof artifacts; needs lane-start guardrail |
| QA trust-layer quality | Medium | PR #490 intent is correct; merge only after updated verification and governance fixes |

---

## PM Decisions / Boundaries

- **Do not close UTV2-433** from historical backfill or old/direct-submitted picks.
- **Do not start duplicate QA trust-layer work.** Fix PR #490 under UTV2-761.
- **Do not start Discord foundation** until PR #490 is resolved or explicitly paused.
- **Do not use Fibery bypass as normal flow.** It is allowed only when the missing Fibery entity is a sync-seeding failure, not a product/proof failure.
- **Do not treat static checks as runtime readiness.** Worker, API, settlement, and Discord delivery proof must be explicit.

---

## Next PM Actions

1. Force PR #490 into compliance: link UTV2-761, update from latest `main`, restore/justify sync config, re-run verification.
2. Re-triage UTV2-739 and UTV2-729 for stale blocked status.
3. Add/track Fibery lane-start guardrail so proof artifacts are seeded before PR open.
4. Schedule UTV2-433 re-run only after fresh post-fix MLB settlements exist.
5. After QA trust layer lands, decide between Discord foundation and UTV2-433 proof rerun based on data availability.

---

## Authority References

| Purpose | File / System |
|---|---|
| Active program status | `docs/06_status/PROGRAM_STATUS.md` |
| Historical record | `docs/06_status/PROGRAM_STATUS_ARCHIVE.md` |
| Operational work queue | Linear |
| PR/source truth | GitHub |
| Lifecycle truth | `docs/ai_context/v2_truth_pack` and current lifecycle proof docs |
| Discord foundation scope | `DISCORD_BOT_FOUNDATION_SPEC.md` |

---

## Update Rule

Update this file at T1/T2 sprint close or whenever GitHub/Linear status would otherwise tell a materially different story.
