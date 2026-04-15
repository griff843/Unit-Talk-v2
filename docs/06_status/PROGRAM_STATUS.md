# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Operational work queue: Linear (live)**
> **Historical record (Phases 1–6, Sprints A–D, Waves 1–2, M11–M13): `PROGRAM_STATUS_ARCHIVE.md`**

## Last Updated

2026-04-15 — **Audit: runtime/readiness docs reconciled with observed truth.**
Worker confirmed DOWN (no runs in 2hr window). Prior claim of worker UP was false. Gate claim "All gates green" referred only to `pnpm verify` static baseline (lint/type-check/build/test) — not to runtime health or deploy-pipeline health. These are now explicitly separated below.

2026-04-12 — **Pre-production hardening wave complete. Canonical lane system operational.**
PR #256 merged: ESLint `.out/**` ignore (green baseline), scope-diff enforcement (S1) in truth-check, stale lane cleanup. 32 ops tests pass. `pnpm verify` green. Final efficiency wave in progress.

2026-04-10 — **Phase 7A in progress — governance brake landed at submission path (UTV2-492).**
UTV2-492 (P7A-02: gate the real queueing path for awaiting_approval picks, PR #222, commit `144d0de`) Done. UTV2-491 (P7A-01: add awaiting_approval lifecycle state, commit `0c95b1e`) Done. Phase 7A remaining: UTV2-493 (approval-path enqueue bridge) + UTV2-494 (proof bundle).

2026-04-10 — **Phase 7 OPENED — governance-first charter.**
Linear project "Phase 7 - Governed Syndicate Machine" (UTV2-485..508, 24 issues, 5 sub-phases 7A–7E). Charter: `docs/06_status/PHASE7_PLAN_DRAFT.md`. Ratification: `docs/06_status/PHASE7R_RATIFICATION.md`.

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Static Baseline | `pnpm verify` PASS (lint, type-check, build, test). Verified 2026-04-12 on main. |
| Runtime Health | **Worker DOWN** — no runs in 2hr window (observed 2026-04-15). Supervisor present but worker not producing output. |
| Deploy Pipeline | Not proven. CI on `main` passes static checks only. No sustained runtime burn-in completed (M4 gate OPEN). |
| Operating Model | Risk-tiered lanes (T1/T2/T3) with canonical lane manifests |
| Active Phase | **Phase 7A — Governance Brake** (2026-04-10). Phases 1–6 closed. |
| Provider | **SGO Pro active (permanent).** Results pipeline uses `odds.<oddID>.score`. 329k provider_offers rows. |
| Worker | **DOWN** — no pipeline runs in 2hr window (2026-04-15 audit). Transient fix PR #188 merged but process not currently healthy. |
| Roadmap | Phases 1–6 closed (see archive). Phase 7A: UTV2-491 Done, UTV2-492 Done. Remaining: UTV2-493, UTV2-494. Active Readiness Program: M1–M4. |

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
| **Worker DOWN** — no pipeline runs in 2hr window | **Critical** | Open — UTV2-572 / UTV2-586 block M4. Runtime must be restored before production readiness proof. |
| Score provenance mostly unknown (819/841 picks = `unknown` edge-source) | High | Open — UTV2-580. Readiness claims blocked until provenance threshold defined and measured. |
| Status docs overstated readiness — worker claimed UP when DOWN | High | **Resolved 2026-04-15** — UTV2-575 corrected this file. |
| Production readiness canary not yet executed | High | G12 gate OPEN. Requires 7-day canary period after worker restored. M4 milestone. |
| Board cap `perSport: 3` saturates for single-capper NBA | Medium | Open — UTV2-284 awaiting PM decision |
| Discord trial role auto-revoke not yet implemented | Low | Open |

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
