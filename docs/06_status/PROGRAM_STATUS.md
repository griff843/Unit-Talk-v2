# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> **Operational work queue: Linear (live).**
> **Historical record:** `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-05-11 — **System audit complete. Functional completeness + Model Edge Proof Program launched. Stranded picks cleared. Codex wiring lanes active.**

- **UTV2-877 scorer fix merged 2026-05-10** — post-fix settlement window now open. Data gate for CLV/ROI scripts: 2026-05-17 (7-day window).
- **System audit complete (2026-05-11):** Promotion score audit (N=12,043) revealed 3 of 5 score inputs materially broken — domainAnalysis gap (UTV2-903), Kelly sizing gap (UTV2-901), boardFit floor bug (UTV2-902). Band persistence never wired (UTV2-906 / DEBT-018). Model registry is 6 provisional baselines with no validation metrics, NFL missing.
- **27-issue execution plan active** across two Linear projects: Functional Completeness & Trust Hardening (M1/M2/M3) + Model Edge Proof Program (M1/M2).
- **Stranded picks cleared:** 1,047 awaiting_approval picks voided 2026-05-11 (UTV2-887 / DEBT-002 closed). Root cause: system-pick-scanner re-enabled 2026-04-26 without lifecycle brake completing before suppression.
- **Stale lane manifests closed:** UTV2-575/580/622/624/625 all confirmed done, UTV2-888 / DEBT-012 closed.
- **Codex lanes active:** UTV2-879 (uniqueness score wiring, job bql89c46j), UTV2-897 (injury change detector, agent ad0d1f598e33e8347).
- **Scripts pre-built for May 17 data gate:** `scripts/clv-analysis.ts` (UTV2-891), `scripts/roi-by-sport.ts` (UTV2-893), `scripts/band-accuracy.ts` (UTV2-892 — blocked on UTV2-906).
- **SGO confirmed: no injury endpoint.** PM approved multi-source injury strategy. UTV2-897 dispatched to Codex for participant.metadata.availability-based detector.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Active operating mode | Functional completeness + model edge proof (27-issue program, post-UTV2-877) |
| Static baseline | `pnpm verify` PASS on main |
| Runtime health | SGO Pro active; 7-day provider_offers retention bounded; 0 awaiting_approval picks in production |
| Provider | SGO Pro active; closing-line truth is `provider_offers WHERE is_closing = true`; `market_universe` is canonical persistence |
| Active Codex lanes | UTV2-879 (uniqueness signal — job bql89c46j), UTV2-897 (injury detector — agent ad0d1f598e33e8347) |
| Data gate | 2026-05-17 — run CLV/ROI scripts for 7-day post-877 window |
| MLB production-readiness gate | **UTV2-433 / UTV2-895** — needs 30+ post-877 MLB settlements with CLV data. Earliest: June 1. |
| Phase | Phase 7A — Governance Brake active |

---

## Active Work Queue

| Priority | Issue | Status | Executor | Notes |
|---:|---|---|---|---|
| 1 | **UTV2-879** — uniqueness score wiring | In Codex (bql89c46j) | Codex | Wire computeUniquenessScore() to promotion-service.ts |
| 2 | **UTV2-897** — injury change detector | In Codex (ad0d1f598e33e8347) | Codex | participant.metadata.availability source |
| 3 | **UTV2-906** — band persistence | Backlog (dispatch when slot opens) | Codex | Write band to picks.metadata + pick_promotion_history; blocks UTV2-892/896 |
| 4 | **UTV2-881** — InMemory constraint enforcement | Backlog (dispatch when slot opens) | Codex | Re-dispatch: previous agent did not complete |
| 5 | **UTV2-882** — smart-form period markets | Backlog (dispatch when slot opens) | Codex | Re-dispatch: previous agent did not complete |
| 6 | **UTV2-891/893** — CLV + ROI scripts | In Proof (data-gated) | Claude | Run on 2026-05-17 |
| 7 | **UTV2-894** — CLV gap root cause | Blocked on UTV2-891 | Claude | After May 17 run |
| 8 | **UTV2-895** — MLB readiness proof | Data-gated (June 1) | Claude | 30+ MLB settlements needed |
| 9 | **UTV2-883** — participant consolidation | PM/T1 gate | Griff | Do not start — T1 plan required first |

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
