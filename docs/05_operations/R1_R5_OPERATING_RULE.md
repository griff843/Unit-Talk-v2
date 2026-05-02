# R1-R5 Operating Rule and Trigger Matrix

**Status:** RATIFIED 2026-04-13
**Authority:** Canonical policy for when R1-R5 verification layers are mandatory, optional, or not applicable.
**Implements:** UTV2-554
**Infrastructure:** `packages/verification/` (R1-R5 engine)
**Machine enforcement source:** `docs/05_operations/r1-r5-rules.json` — this JSON is the authoritative trigger matrix consumed by `scripts/ci/r-level-check.ts`. The human-readable table in §3 is informational only; the JSON wins on any conflict.

---

## 1. Purpose

This document defines the durable operating policy for the R1-R5 verification and simulation control plane. It answers one question for every change type: **which R-levels must run before the change can be declared verified?**

Without this policy, sessions re-derive verification requirements from scratch, producing inconsistent coverage.

---

## 2. R-Level Definitions

| Level | Name | What It Proves | Infrastructure |
|-------|------|---------------|----------------|
| **R1** | Foundation | Clock/adapter wiring is correct; mode isolation holds | `engine/clock.ts`, `engine/adapters.ts`, `engine/run-controller.ts` |
| **R2** | Deterministic Replay | Same inputs produce same outputs (hash stability) | `engine/replay-orchestrator.ts`, `engine/determinism-validator.ts` |
| **R3** | Shadow Comparison | New logic produces identical or intentionally different outputs vs reference | `engine/shadow/` |
| **R4** | Fault Injection | System behaves correctly under failure (idempotency, recovery, degraded data) | `engine/fault/` |
| **R5** | Strategy Evaluation | Betting strategy sizing, risk limits, and drawdown guards fire correctly | `engine/strategy/`, `packages/domain/src/strategy/` |

---

## 3. Trigger Matrix

Each cell is one of:
- **M** = Mandatory (must pass before merge)
- **O** = Optional (recommended, not blocking)
- **—** = Not applicable

| Change Type | R1 | R2 | R3 | R4 | R5 | Notes |
|------------|----|----|----|----|----|----|
| **Submission flow** (validation, intake, payload shape) | M | M | O | O | — | R2 catches lifecycle regressions from payload changes |
| **Lifecycle / FSM** (state transitions, writer roles, guards) | M | M | M | M | — | Highest-risk surface. All applicable levels mandatory |
| **Promotion / scoring** (weights, gates, score components) | M | M | M | O | M | R3 catches scoring drift; R5 validates strategy impact |
| **Settlement / grading** (result resolution, corrections) | M | M | M | M | — | R4 covers settlement conflict and correction edge cases |
| **Discord delivery** (embed format, channel routing, outbox) | M | — | — | O | — | Replay doesn't cover delivery; R4 covers timeout/retry |
| **Smart Form payload shape** | M | M | — | — | — | R2 ensures downstream consumers aren't broken |
| **Command Center read surfaces** | — | — | — | — | — | Read-only; no pipeline side effects to verify |
| **Docs / specs / housekeeping** | — | — | — | — | — | No code behavior change |
| **Infra / CI / workflow** | — | — | — | — | — | Unless the change alters verification infrastructure itself |
| **Verification infrastructure** (`packages/verification/`) | M | M | O | O | O | Self-referential: changes to the verifier must be verified |
| **Ingestor / provider data** | M | O | M | O | — | R3 catches provider-data drift against known-good baselines |
| **Strategy / bankroll parameters** | — | — | — | — | M | Pure strategy surface; R5 is the only applicable gate |

---

## 4. How to Apply the Matrix

### Before starting a lane

1. Identify the change type(s) from the matrix above
2. Union all mandatory R-levels across change types
3. Record the required R-levels in the lane manifest's `verification` field

### During verification

1. Run each mandatory R-level using the existing infrastructure
2. For R2: run the determinism gate (`pnpm test` includes the R2 replay hash check)
3. For R3/R4/R5: use the appropriate driver script or certification lane
4. Record results in the proof bundle

### At the done-gate

`ops:truth-check` validates that mandatory R-levels were executed and passed. Missing mandatory verification blocks lane closure.

---

## 5. Live-Data Boundary

R1-R5 replay and simulation prove **logic correctness** — they do not prove **live connectivity, runtime performance, or production data integrity**.

### What replay CAN prove

- State machine transitions are correct for a given event stream
- Determinism holds (same inputs always produce same hash)
- Scoring/promotion logic produces expected outputs
- Fault handling behaves correctly under synthetic failures
- Strategy sizing and risk limits fire at the right thresholds

### What ONLY live data can prove

- Supabase connectivity and row-level security
- Provider API availability and response shape
- Discord delivery success and rate limiting
- Real-time latency under production load
- Data quality of actual provider feeds
- Accumulated volume thresholds (hit rate, ROI cohort minimums)

### The rule

> **Never claim full end-to-end verification from replay alone.**
> Replay proves logic. Live proof (`pnpm test:db`, runtime evidence bundle) proves connectivity and data.
> Both are required for T1 completion. T2/T3 require replay where mandatory per the matrix; live proof is required only when the change touches a live-data surface.

---

## 6. Overclaim Guard

The following claims are **never valid** from replay/simulation alone:

| Invalid Claim | Why | What to Say Instead |
|--------------|-----|-------------------|
| "E2E verified" | Replay doesn't touch live infrastructure | "Logic verified via R2 replay; live proof pending" |
| "Production-ready" | Replay uses synthetic/historical data | "Pipeline-certified for [sport]; live gate is a separate issue" |
| "No regressions" | Replay covers only the event stream in the corpus | "No regressions in the replay corpus; coverage is [X events, Y picks]" |
| "Settlement correct" | Replay settlement uses historical records | "Settlement logic correct for historical records; live settlement requires provider API" |

### When the guard fires

If a proof bundle, lane closure comment, or Linear status update contains an overclaim term ("E2E verified", "production-ready", "no regressions" without qualification), the `ops:truth-check` done-gate should flag it for human review.

---

## 7. Sport Simulation Certification

Sport-specific simulation baselines follow the [Sport Simulation Certification Framework](SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md). That framework defines the 4-gate certification process and the two-issue rule (simulation baseline vs live production-readiness gate).

This operating rule governs **per-change verification**. The certification framework governs **per-sport onboarding**.

---

## 8. Changelog

| Date | Change | Issue |
|------|--------|-------|
| 2026-04-13 | Initial ratification | UTV2-554 |
