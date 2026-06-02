# Constitutional Convergence Backlog Plan

> SPRINT-CONSTITUTIONAL-CONVERGENCE-002 · 2026-06-02.
> Defines the next sprint sequence **before** creating Linear issues. **No Linear issues are created in this sprint** — this plan tells PM exactly what to create, and when. Ordered by constitutional sequencing (§18.2: truth → governance → scale).

## Priority 0 — Finish and merge PR #948 (+ this convergence work)
- **Constitutional layers:** all (the constitution itself must land on `main`).
- **Reason:** the constitution and canonical program state must be repo-authoritative on `main` before any work is generated from it.
- **Blocking drift:** none (this is the enabler).
- **Executor:** Claude (done) → PM merge.
- **Expected proof:** PR #948 merged; `pnpm constitution:check` green on `main`.
- **Linear issues now?** No — this is a PR merge, not a backlog item.

## Priority 1 — Certification State Reconciliation (`SPRINT-CERTIFICATION-STATE-RECONCILIATION-003`)
- **Constitutional layers:** §4.15 (Governance & Certification), §10 (Proof & Certification Framework).
- **Reason:** certification records are asymmetric/non-canonical — normalize P1–P5 records so "certified" is deterministic.
- **Blocking drift:** D-CONST-3 (missing canonical cert records), D-CONST-1/2 stale-reference cleanup, D-CONST-7 (types).
- **Scope:** author canonical `PROGRAM_1_CERTIFICATION.md` + `PROGRAM_4_CERTIFICATION.md` from existing evidence; mark stale Linear references subordinate; **no certification advancement without proof.**
- **Executor:** Claude (doc authoring) + PM (ratify); Codex for types regen.
- **Expected proof:** canonical per-program cert docs + reconciled CERT_BOARD; `schema:parity` clean.
- **Linear issues now?** **Create when Priority 0 merges.**

## Priority 2 — Proof Gate Hardening (`SPRINT-PROOF-GATE-EXECUTION-BOUND-004`)
- **Constitutional layers:** §2.11 (Proof Over Narrative), §10, §22 (anti-patterns).
- **Reason:** make proof gates execution-bound, not string-bound; eliminate false proof confidence.
- **Blocking drift:** D-CONST-4.
- **Scope:** `t1-proof-gate` consumes a machine-readable `test:db` result (status, row counts, SHA); skip = FAIL.
- **Executor:** Codex (CI/gate hardening).
- **Expected proof:** gate self-test rejecting a string-only proof file.
- **Linear issues now?** Create after Priority 1, or in parallel (independent of cert authoring).

## Priority 3 — Runtime Freshness / Operations
- **Constitutional layers:** §4.1 (Data Acquisition), §4.14 (Observability).
- **Reason:** resolve stale ingestion status **without buying SGO prematurely**; support no-cost/mock/replay freshness proof; ensure monitoring alerts are acted on.
- **Blocking drift:** D-CONST-6.
- **Scope:** mock/replay freshness proof path; wire `passing:false` snapshots to an acted-upon alert. **Do not activate SGO** until intentionally reactivated.
- **Executor:** Claude (mock/replay scaffolding) + Griff (ingestion when reactivated).
- **Expected proof:** freshness proof via mock/replay; alert-acknowledged evidence.
- **Linear issues now?** Create after Priority 1; tag as no-cost path.

## Priority 4 — P3 Decision Integrity Remediation
- **Constitutional layers:** §4.3, §4.4, §4.5, §4.6, §4.8, §4.9.
- **Reason:** P3 is ACTIVE — remediate decision-integrity surfaces and the edge-as-echo gap.
- **Blocking drift:** D-CONST-5.
- **Scope:** R1 injury/status guard; R4 posting-window setter; **R10 feature-wiring plan (plan only — do not start R10 implementation this sprint)**; edge-as-echo remediation design.
- **Executor:** Claude (guards/plan) + Codex (adversarial review).
- **Expected proof:** guard tests; R10 wiring **plan**; edge remediation design doc.
- **Linear issues now?** Create after Priorities 1–2; R10 implementation gated behind its plan.

## Priority 5 — P4 Execution / Economic Truth
- **Constitutional layers:** §4.10, §4.11, §4.12, §4.19.
- **Reason:** P4 is CONDITIONAL — harden execution + scaffold economic truth (no claims).
- **Blocking drift:** runtime dead-letters; no realized CLV/attribution data.
- **Scope:** dead-letter remediation; CLV proof scaffolding; attribution proof **once data exists**. No economic-edge/ROI/CLV claims.
- **Executor:** Claude + Codex; Griff for runtime/data.
- **Expected proof:** dead-letter drain evidence; CLV/attribution scaffolding (not results).
- **Linear issues now?** Create after Priorities 1–4; economic-proof issues gated on live data.

## Priority 6 — P5 remains FROZEN
- **Constitutional layers:** §4.17, §4.18.
- **Reason:** capital/treasury/scaling require certification + burn-in PASS — neither exists.
- **Blocking drift:** no burn-in PASS; D-CONST-3 (no P5 cert).
- **Scope:** **none.** No treasury, no capital scaling, no live capital, no customer-money claims.
- **Executor:** — (frozen).
- **Expected proof:** — (frozen until burn-in PASS).
- **Linear issues now?** **No.** Do not create P5-C/P5-D work issues.

## Issue-creation guidance for PM
- **Create now:** nothing (PR #948 must merge first).
- **Create immediately after merge:** Priority 1 (cert reconciliation) and Priority 2 (proof-gate) issues.
- **Create after Priority 1:** Priorities 3 and 4.
- **Create gated/later:** Priority 5 economic-proof (needs data); Priority 6 (frozen — none).
