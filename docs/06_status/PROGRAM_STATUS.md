# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Operational work queue: Linear (live)**
> **Historical record (Phases 1–6, Sprints A–D, Waves 1–2, M11–M13): `PROGRAM_STATUS_ARCHIVE.md`**

## Last Updated

2026-04-22 — **M1 Runtime Foundation complete. M4 gate partially unblocked.**
UTV2-602 (cloud deploy path) and UTV2-621 (ingestion staleness alerting) both merged and marked Done in Linear. M1 milestone is closed. UTV2-588 (Smart Form convergence proof) unblocked and moved to Ready. UTV2-654 (E2E Live Canary) moved to Ready — deploy path prerequisite satisfied. UTV2-587/589/590 remain Blocked Internal on UTV2-576 (closing-line truth). Phase 7A brake source set ratified (UTV2-628, PR #429). CI Fibery sync fixed (UTV2-709, PR #433).

2026-04-15 — **Audit: runtime/readiness docs reconciled with observed truth.**
Worker confirmed DOWN (no runs in 2hr window). Prior claim of worker UP was false. Gate claim "All gates green" referred only to `pnpm verify` static baseline (lint/type-check/build/test) — not to runtime health or deploy-pipeline health. These are now explicitly separated below.

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Static Baseline | `pnpm verify` PASS (lint, type-check, build, test). CI on `main` passes. |
| Runtime Health | **Unknown** — deploy path (UTV2-602) merged 2026-04-22. Worker health post-deploy not yet confirmed. Run `pnpm test:db` + `pnpm stage:freshness` against hosted instance to verify. |
| Deploy Pipeline | **Shipped** — UTV2-602 (PR #423) merged. CI-driven deploy path active. |
| Operating Model | Risk-tiered lanes (T1/T2/T3) with canonical lane manifests |
| Active Phase | **Phase 7A closed. M4 Production Proof gates active.** |
| Provider | **SGO Pro active (permanent).** Results pipeline uses `odds.<oddID>.score`. |
| Roadmap | M1 **COMPLETE**. M2 partial (UTV2-576 open). M3 partial (UTV2-579 ✓). M4 gate: UTV2-654 (E2E canary) now Ready. |

---

## Milestone State

| Milestone | Status | Remaining |
|-----------|--------|-----------|
| **M1 Runtime Foundation** | ✅ **COMPLETE** | — (602 + 621 both Done) |
| **M2 Data & Canonical Truth** | 🔴 Blocked | UTV2-576 (closing-line truth) still open |
| **M3 Machine & Decisioning** | 🟡 Partial | UTV2-579 ✓; others dependent on M2 |
| **M4 Production Proof** | 🟡 Partial | UTV2-588 Ready; 587/589/590 blocked on 576/581 |

## M4 Issue Detail

| Issue | Title | Status | Blocked On |
|-------|-------|--------|------------|
| UTV2-587 | E2E governed pipeline freshness proof | Blocked Internal | UTV2-576 (closing-line) |
| UTV2-588 | Smart Form ↔ API convergence proof | **Ready** | — (577 Done, 602 Done) |
| UTV2-589 | Settlement/CLV/P&L validation | Blocked Internal | UTV2-576 + UTV2-581 |
| UTV2-590 | Full production-readiness closeout | Blocked Internal | All above |
| UTV2-654 | E2E Live Canary (T1) | **Ready** | Worker health confirm needed |

---

## Active PRs (pending review)

| PR | Issue | Tier | Status |
|----|-------|------|--------|
| [#434](https://github.com/griff843/Unit-Talk-v2/pull/434) | UTV2-627 model health scanner | T1 | Needs `t1-approved` label |
| [#435](https://github.com/griff843/Unit-Talk-v2/pull/435) | UTV2-659 Google OAuth Smart Form | T2 | In Review |

---

## Recently Merged (2026-04-15 → 2026-04-22)

| PR | Issue | Description |
|----|-------|-------------|
| [#423](https://github.com/griff843/Unit-Talk-v2/pull/423) | UTV2-602 | Cloud deploy path — M1 gate ✓ |
| [#427](https://github.com/griff843/Unit-Talk-v2/pull/427) | UTV2-621 | Ingestion staleness alerting — M1 gate ✓ |
| [#429](https://github.com/griff843/Unit-Talk-v2/pull/429) | UTV2-628 | Execution quality → model trust feedback |
| [#430](https://github.com/griff843/Unit-Talk-v2/pull/430) | UTV2-634 | Live availability signals wired |
| [#433](https://github.com/griff843/Unit-Talk-v2/pull/433) | UTV2-709 | CI: fix Fibery sync (vars vs secrets) |

---

## Closed Phase Summary

| Phase | Gate SHA | Proof | Closed |
|-------|---------|-------|--------|
| 1 | `66c9cc1` | — | 2026-04-09 |
| 2 | `c077ab1` | UTV2-464 | 2026-04-09 |
| 3 | `4b5e4a9` | UTV2-471 | 2026-04-09 |
| 4 | `5daaf0b` | UTV2-475 | 2026-04-09 |
| 5 | `aeb978e` | UTV2-478 (7/7 PASS) | 2026-04-10 |
| 6 | `b74c384` | UTV2-481 (7/7 PASS) | 2026-04-10 |

---

## Live Routing

| Target | Status |
|--------|--------|
| `discord:canary` | **LIVE** — permanent control lane |
| `discord:best-bets` | **LIVE** |
| `discord:trader-insights` | **LIVE** |
| `discord:recaps` | **LIVE** |
| `discord:exclusive-insights` | Code merged — activation deferred (PM approval required) |

---

## Open Risks

| Risk | Severity | Status |
|------|----------|--------|
| **Worker runtime post-deploy unconfirmed** | **Critical** | Deploy path (602) merged but hosted worker health not yet observed. Must confirm before M4. |
| **Closing-line truth gap** (UTV2-576) | High | Open — blocks UTV2-587/589/590. `market_universe.closing_line` coverage near-zero in last audit. |
| Settlement sample volume too thin (UTV2-581) | High | Open — only 16 settlement records in last audit sample. Blocks UTV2-589. |
| Score provenance mostly unknown (UTV2-580) | High | Open — 819/841 picks = `unknown` edge-source. |
| Production readiness canary not yet executed | High | UTV2-654 now Ready. Requires worker health confirmation first. |
| Board cap `perSport: 3` saturates for single-capper NBA | Medium | Open — UTV2-284 awaiting PM decision |

---

## Open New Issues (created 2026-04-22)

| Issue | Title | Tier |
|-------|-------|------|
| UTV2-711 | Update PROGRAM_STATUS.md (this file — ongoing) | T3 |
| UTV2-712 | Wire model health alerts into Command Center UI | T2 |

---

## Runner Architecture

| Script | Files | Surface |
|--------|-------|---------|
| `pnpm test:apps` | 10 | api (6) + worker + operator-web + discord-bot |
| `pnpm test:verification` | 4 | packages/verification |
| `pnpm test:domain-probability` | 6 | domain/probability + outcomes-core |
| `pnpm test:domain-features` | 9 | domain/features + models |
| `pnpm test:domain-signals` | 6 | domain/signals + bands + calibration + scoring |
| `pnpm test:domain-analytics` | 9 | domain/outcomes + market + eval + edge + rollups + system-health + risk + strategy + market-key |

---

## Do Not Start Without Planning

- `discord:game-threads` or `discord:strategy-room` live routing
- Broad multi-channel expansion
- Any new product surface without a ratified contract

---

## Authority References

| Purpose | File |
|---------|------|
| **Active program status** | this file |
| **Historical record** | `PROGRAM_STATUS_ARCHIVE.md` |
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Platform surfaces | `docs/03_product/PLATFORM_SURFACES_AUTHORITY.md` |
| Phase 7 charter | `docs/06_status/PHASE7_PLAN_DRAFT.md` |
| Phase 7 ratification | `docs/06_status/PHASE7R_RATIFICATION.md` |

---

## Update Rule

Update at **T1/T2 sprint close only**. T3: update Linear only, no PROGRAM_STATUS.md change required.
