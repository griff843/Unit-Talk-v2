# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`.
> **Operational work queue: Linear (live).**
> **Historical record:** `PROGRAM_STATUS_ARCHIVE.md`.

## Last Updated

2026-04-26 — **PM reconciliation complete through PR #489. QA trust layer is the active PR but blocked by governance cleanup.**

- **UTV2-751 is Done.** PR #489 merged as proof closure: pre-April-20 SGO historical backfill is **not** a current CLV blocker because all current settled picks are inside the 2026-04-20+ `provider_offers` data window.
- **UTV2-760 created.** Historical pre-April-20 SGO backfill remains tracked as low-priority archive/completeness work only; it does not block CLV, grading, settlement, or UTV2-433.
- **UTV2-433 remains open.** MLB production-readiness gate cannot close from backfill or retroactive evidence. It requires fresh post-fix MLB settlements from the fixed provenance path with `clvBackedOutcomeCount >= 10`.
- **UTV2-761 created.** PR #490 is the active QA trust-layer implementation lane, but it is **not merge-ready** until it links to UTV2-761, updates onto latest `main`, re-runs verification, and resolves the `.ops/sync.yml` governance bypass.
- **Recent completed work:** UTV2-747 Line-Shopper, UTV2-736 R5 CLV ROI proof, UTV2-759 grading/QA unblock, UTV2-754 MLB provenance remediation, UTV2-758 candidate builder, UTV2-757 candidate scanner, UTV2-756/755 SGO fetch hardening.

---

## Current State

| Field | Value |
|---|---|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Active operating mode | Proof/readiness hardening, not broad feature expansion |
| Static baseline | Recent PRs report `pnpm verify` PASS; PR #490 must re-run after updating from latest `main` |
| Runtime health | **Not fully proven** — worker/runtime health must be verified separately from static checks |
| Provider | SGO Pro active; closing-line truth is `provider_offers WHERE is_closing = true`; `market_universe` is canonical persistence |
| Current active PR | **PR #490** — QA trust layer; blocked by PM gate |
| Current active Linear lane | **UTV2-761** — Experience QA trust layer |
| Main readiness gate still open | **UTV2-433** — MLB production-readiness gate |
| Next non-QA infrastructure candidate | Discord bot foundation, after QA/status cleanup |

---

## Active Work Queue

| Priority | Issue / PR | Status | PM Direction |
|---:|---|---|---|
| 1 | **PR #490 / UTV2-761** | Open, blocked | Fix lane linkage, latest-main drift, verification, and `.ops/sync.yml` governance before merge |
| 2 | **UTV2-433** | In Progress | Wait for fresh post-fix MLB settlement evidence; do not close from historical backfill |
| 3 | **UTV2-739** | Stale umbrella | Reconcile child issue completions and either move to PM Review or Ready to Close |
| 4 | **UTV2-729** | Stale/blocked | Re-triage after UTV2-736/751; likely obsolete or needs rewritten proof purpose |
| 5 | **UTV2-760** | Backlog | Historical completeness only; low priority; does not block readiness |

---

## Recently Merged / Closed

| PR | Issue | Tier | Result |
|---|---|---|---|
| #489 | UTV2-751 | T2 | SGO historical backfill proof accepted; current CLV not blocked; UTV2-760 follow-up created |
| #488 | UTV2-759 | T2 | Smart Form/Command Center QA blockers fixed; Smart Form QA passes; Command Center dependency warnings remain explicit |
| #487 | UTV2-736 | T2 | R5 CLV ROI proof generated; all shadow slices blocked by data as expected |
| #486 | UTV2-747 | T2 | Line-Shopper operator endpoint + Command Center UI merged |
| #485 | — | T2/T3 foundation | Experience QA Agent foundation merged |
| #484 | UTV2-759 | T2 | Auto-grading end-to-end proof / market-key normalization merged |
| #483 | UTV2-754 | T2 | MLB provenance path remediation merged |
| #481 | UTV2-758 | T2 | CandidateBuilderService populates `pick_candidates` from `provider_offers` |
| #480 | UTV2-757 | T2 | CandidatePickScanner converts scored candidates into governed picks |
| #479 | UTV2-756 | T3 | SGO fetch loop total-time budget added |
| #478 | UTV2-755 | T2 | SGO fetch timeout and per-league error isolation added |

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
