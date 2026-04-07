# Sport Simulation Certification Framework

**Status:** Ratified 2026-04-07
**Authority:** T1 — methodology governing all sport simulation baseline lanes
**Canonical model:** UTV2-320 (NBA) — closed Done 2026-04-07
**Distinct from:** `SIMULATION_MODE_CONTRACT.md` (that governs runtime Discord delivery simulation, not the R1-R5 strategy/verification engine)

---

## 1. Purpose

The simulation certification lane proves that the R1-R5 verification and simulation control plane (`packages/verification/`) is correctly wired for a sport — before live data is required and before any model claim is made.

This replicates the syndicate operating pattern: build and prove the pipeline on a controlled synthetic dataset first. Only after the pipeline is certified does live data accumulation and live-gate closure become meaningful.

**What simulation certification proves:**
- The event lifecycle (SUBMITTED → GRADED → POSTED → SETTLED) processes correctly for the sport's pick structure
- The determinism guarantee holds (same inputs → same hash, always)
- Strategy sizing and risk limits fire correctly on the sport's pick set
- Fault injection (idempotency guard) passes
- The drawdown/adverse-scenario guard activates correctly

**What simulation certification does not prove:**
- That the model has edge (all results are synthetic, designed-in)
- That the sport is live-production-ready (separate gate)
- That F2–F10 fault scenarios are covered (only F1 is required for certification)
- That R3 shadow mode is exercised (not required for single-lane synthetic proof)

---

## 2. The Two-Issue Rule

Every sport follows a mandatory two-issue separation. These must never be merged into a single Linear issue.

### Issue A — Simulation Baseline

**Closes when:** All 4 standard gates pass and PM approves closure.

**Does not require:** live DB, live picks, live ingestor data, accumulated CLV.

**Title pattern:** `MP-MX: [SPORT] simulation baseline certification`

**Status on close:** `Done` with explicit "not proven" list in closing comment.

### Issue B — Live Production-Readiness Gate

**Created at:** the moment Issue A closes (PM decision triggers creation).

**Closes when:** Both live thresholds are met simultaneously in a single `pnpm ops:brief` run.

**Title pattern:** `MP-MX: [SPORT] live production-readiness gate`

**Hard blocked by:** the ingestor opening/closing line tag fix (UTV2-400 equivalent per sport).

**Does not close Issue A:** live gate closure is a separate event, not a continuation of simulation baseline.

### Why this separation matters

Mixing them produces a false completion signal. A sport where the simulation passes but live data is absent is not production-ready — but it is engine-ready. These are different facts with different implications. Keeping them as separate issues enforces that distinction in the Linear board state at all times.

---

## 3. Standard Gates

All four gates must pass in a single driver run for a sport to be declared "simulation baseline complete." A partial pass is not complete.

### Gate 1 — Volume

| Requirement | Value |
|---|---|
| Minimum picks | 50 |
| Hit rate (designed-in) | 80% (40W/10L) |
| Tier distribution | At least A, B, and C tiers represented |
| Loss cluster | At least one run of 3+ consecutive losses (tests drawdown resilience) |
| Market coverage | At least 3 picks per core market family for the sport |
| Date span | At least 5 game weeks |
| R2 errors | 0 |

**Pass condition:** `replayResult.errors.length === 0` across both R2 runs.

### Gate 2 — Strategy Comparison

Two strategies must both place a meaningful number of bets. "Meaningful" accounts for the sport's market structure and the risk limits that correctly apply.

| Strategy | Minimum bets placed | Notes |
|---|---|---|
| `flat-unit` | ≥ 30 | `maxCorrExposure: 0.40` caps cumulative same-sport exposure at 40% of bankroll. At $100/bet, ~36 bets before cap on an all-sport set. |
| `[sport]-kelly-sim` | ≥ 5 | Inline simulation-only variant with relaxed `maxExposurePerSport`. Must NOT modify canonical `PREDEFINED_STRATEGIES`. Must be labeled `SIMULATION-ONLY` in the driver. |

**Why bets placed < total picks is correct:** The risk management engine (correlation exposure, sport concentration caps) is working correctly. A flat-unit run that places every single pick regardless of concentration is not a sign of health — it is a sign the limits were bypassed.

**Canonical config invariant:** `PREDEFINED_STRATEGIES` in `strategy-evaluation-engine.ts` must not be modified. The sport-specific Kelly variant is defined inline in the driver script only.

**Pass condition:** `flatResult.betsPlaced >= 30 && sportKellyResult.betsPlaced >= 5`

### Gate 3 — Determinism Cross-Validation

Two independent `ReplayOrchestrator` runs on freshly-built event stores from the same input function must produce identical SHA-256 determinism hashes.

**What this proves:** The engine has no hidden state, clock drift, or random element that would make replay non-deterministic.

**Implementation:** Build `store1` and `store2` via separate calls to `buildEventStore()`. Construct separate `VirtualEventClock` and `AdapterManifest` instances. Run both. Assert hash equality.

**Pass condition:** `replayResult1.determinismHash === replayResult2.determinismHash`

### Gate 4 — Adverse Scenario

A 10-pick all-loss proof set run through `flat-unit` must:
- Complete with 0 R2 errors
- Produce a final bankroll within the expected compounding range ($8,500–$9,200 for a $10,000 start at 1%/bet)
- Not produce a negative bankroll
- Not crash the engine

The drawdown halt guard is **not expected to activate** at 10 losses (9.56% drawdown < 50% flat-unit halt threshold). Not activating is correct. If it activates, that is also acceptable provided the halt reason is logged.

**Pass condition:** `adverseReplay.errors.length === 0 && adverseFlatResult.finalBankroll > 0 && bankrollInExpectedRange`

---

## 4. Standard "Not Proven" List

Every simulation baseline closing comment must include this list verbatim (with sport substituted). This is not optional — it is the explicit scope boundary that protects against future drift.

```
What is not proven by this simulation baseline:

1. Hit rate is not a model result. [X]% is designed-in. This proves the
   pipeline is correct, not that the model has edge.

2. Live data gate is not satisfied. [SPORT] live production-readiness
   requires live settled picks with CLV data and provider_offers with
   opening/closing tags. This proof does not touch those.

3. F2–F10 fault scenarios are not run. Only F1 (idempotency) is required
   for simulation baseline certification.

4. R3 shadow mode is not exercised. Not meaningful for single-lane
   synthetic proof.
```

---

## 5. Standard Proof Bundle

Every certified sport produces this output structure under `out/`. Files are produced by the driver script and committed to the PR as evidence.

```
out/
  utv2-XXX-[sport]-simulation-summary.json     <- top-level summary, all gates
  replay-runs/
    utv2-XXX-[sport]-sim-*-r2-run1/            <- R2 run 1 proof bundle
  fault-runs/
    fault-f1-*/                                 <- R4 F1 idempotency proof bundle
  strategy-runs/
    flat-unit/[date]/                           <- Gate 2 flat-unit bundle
    [sport]-kelly-sim/[date]/                   <- Gate 2 sport-kelly bundle
    cmp-flat-unit-vs-[sport]-kelly-sim/[date]/  <- Gate 2 comparison report
```

The `summary.json` must include these top-level fields:

```json
{
  "runId": "...",
  "issue": "UTV2-XXX",
  "sport": "[SPORT]",
  "generatedAt": "...",
  "proofSet": { "pickCount": 50, "wins": 40, "losses": 10, "tiers": {}, "marketCoverage": {} },
  "gates": {
    "gate1Volume": { "pass": true, "run1Errors": 0, "run2Errors": 0 },
    "gate2Strategy": { "pass": true, "flatUnit": {}, "sportKelly": { "note": "SIMULATION-ONLY" } },
    "gate3Determinism": { "pass": true, "run1Hash": "...", "run2Hash": "..." },
    "gate4Adverse": { "pass": true, "finalBankroll": 9043.82, "maxDrawdown": 0.0956 }
  },
  "r4Fault": { "pass": true, "assertionsPassed": 4 },
  "verdict": "PASS",
  "simulationBaselineComplete": true,
  "notes": ["Sport-specific notes", "SIMULATION-ONLY variant note", "Not proven list summary"]
}
```

---

## 6. Standard Linear Issue Pattern

### Issue A template — Simulation Baseline

```
Title: MP-MX: [SPORT] simulation baseline certification

Description:
## Purpose
Certify the R1-R5 simulation engine for [SPORT] using the standard
sport simulation certification framework (see
docs/05_operations/SPORT_SIMULATION_CERTIFICATION_FRAMEWORK.md).

Canonical model: UTV2-320 (NBA) — closed Done 2026-04-07.

## Driver
scripts/utv2-XXX-[sport]-simulation.ts

## Standard gates (all 4 must pass)
- [ ] Gate 1: 50 picks, 0 R2 errors, tier mix, loss cluster
- [ ] Gate 2: flat-unit >= 30 bets, [sport]-kelly-sim >= 5 bets
- [ ] Gate 3: determinism cross-validation PASS (run1 hash == run2 hash)
- [ ] Gate 4: adverse (10L/0W) completes, bankroll in expected range

## Acceptance
VERDICT: PASS in summary JSON.
All gates explicitly logged.
Not-proven list posted in closing comment.
PR merged to main.

## Not in scope
- Live production-readiness gate (separate Issue B)
- Live DB, live picks, live CLV data
- F2-F10 fault scenarios
- Model edge claims
```

**Labels:** `kind:runtime`, `tier:T2`, `lane:claude-only`
**Milestone:** MP-M3 (or active milestone)

### Issue B template — Live Production-Readiness Gate

```
Title: MP-MX: [SPORT] live production-readiness gate

Description:
## Context
Spun off from UTV2-XXX ([SPORT] simulation baseline) on PM closure.

Simulation baseline is complete. This issue tracks the live data
thresholds that must be met before the [SPORT] model lane can progress
to live production-readiness.

## Hard thresholds (verified via pnpm ops:brief)
- clvBackedOutcomeCount >= 10
- openCloseRowCount >= 5

Both must be MET simultaneously in a single ops:brief run.

## Dependencies
- Ingestor opening/closing line tag fix must be merged and deployed
- Time-gated: requires operational picks accumulation

## Acceptance criteria
- [ ] Ingestor fix merged and deployed
- [ ] At least one full ingest cycle with opening/closing tags populated
- [ ] pnpm ops:brief: openCloseRowCount >= 5: MET
- [ ] pnpm ops:brief: clvBackedOutcomeCount >= 10: MET
- [ ] Both gates MET in the same run

## Not in scope
- No code changes to simulation engine or driver scripts
- No changes to ops:brief thresholds (do not lower them)
- No model claims (simulation path closed under Issue A)
```

**Labels:** `kind:runtime`, `tier:T2`
**Blocked by:** ingestor opening/closing tag fix issue
**Related to:** Issue A

---

## 7. Sport Application Order

### Priority order: MLB → NHL → NFL

**MLB — immediately**

- Season opened April 2026. Player prop markets (strikeouts, hits, RBIs, bases, runs) are active now.
- Driver work is 1–2 days: clone NBA driver, replace proof set with MLB player props, adjust markets.
- Market families differ from NBA (no points/rebounds/assists) — new canonical map needed, but the engine handles any market string.
- Live gate (UTV2-431 equivalent) can begin accumulating data in parallel.
- Recommended issue: create now, target closure within current sprint.

**NHL — next (April–June 2026)**

- Playoffs run April–June. This is the highest-volume NHL window of the year.
- Market families: shots, goals, assists, saves (goalie-specific).
- Proof set design note: goalie markets (saves) are structurally different — a pick on goalie saves requires knowing the starting goalie. For simulation, this is synthetic so no issue; flag for live gate design.
- Recommended issue: create now, close during playoffs window.

**NFL — after summer (July–August build, September activation)**

- Season starts September 2026. Off-season now — no time pressure.
- Market families: passing yards, rushing yards, receiving yards, TDs, completions.
- NFL has a weekly cadence unlike daily NBA/MLB/NHL — proof set design must reflect this (50 picks across 10+ game weeks, not 14 game days).
- Recommended issue: create in July 2026, close before week 1.

---

## 8. What Lives Where

### In docs (this file and sport-specific addenda)
- The framework itself (this document)
- The "not proven" list template — must be cited verbatim on every closure
- The standard gate definitions — do not lower thresholds without PM approval
- The two-issue rule — must not be collapsed
- Market family documentation per sport (what markets constitute "core coverage")

### In scripts (one file per sport)
- `scripts/utv2-XXX-[sport]-simulation.ts` — the driver
- Clone from `scripts/utv2-320-nba-simulation.ts`
- Replace: proof set data, game times, players, market names, sport label
- Keep: all 4 gate implementations, `buildEventStore()` parameterization, inline sport-kelly config, summary JSON structure, `SIMULATION-ONLY` label
- The driver is the proof. It must be self-contained and runnable in one command: `npx tsx scripts/utv2-XXX-[sport]-simulation.ts`

### In issue templates (Linear)
- Issue A and Issue B description templates (Section 6 above)
- These are not CLAUDE.md instructions — they are reference templates pasted into Linear when creating issues
- The acceptance criteria checklist in Issue A is the gate source of truth for that lane

### Not in CLAUDE.md
- Do not add per-sport simulation detail to root CLAUDE.md — it would bloat the instructions file
- CLAUDE.md should reference this document by path if simulation certification is relevant to a session

---

## 9. The Invariants That Must Never Change

These are load-bearing across all sports and may not be relaxed without explicit PM approval:

1. **50-pick minimum.** Fewer than 50 picks does not provide enough surface to exercise tier filtering, loss clustering, and corr limit behavior.
2. **Two-issue rule.** Simulation and live-gate are always separate Linear issues. No exceptions.
3. **`PREDEFINED_STRATEGIES` is never modified** to make a sport's simulation pass. Inline sport-specific Kelly variants are always labeled `SIMULATION-ONLY`.
4. **The "not proven" list is always posted verbatim** in the closing comment. It is not optional and must not be abbreviated.
5. **Gate thresholds are not lowered** to force a PASS. If a threshold is producing unexpected results, the correct response is to understand the engine behavior (as happened with `maxCorrExposure` in the NBA lane) and calibrate the threshold to match correct behavior — not to lower it arbitrarily.
6. **The adverse scenario always uses 10 picks, all losses.** This is not a variable. Its purpose is to prove the drawdown math is correct, not to prove the guard activates.

---

## Appendix: NBA Lane as Canonical Reference

| Artifact | Value / Path |
|---|---|
| Issue | UTV2-320 — closed Done 2026-04-07 |
| Follow-on | UTV2-431 — live production-readiness gate, blocked on UTV2-400 |
| Driver | `scripts/utv2-320-nba-simulation.ts` |
| Adapter factory | `packages/verification/src/engine/simulation-adapters.ts` |
| PR | griff843/Unit-Talk-v2#165 (merged `092104c`) |
| Proof set | 50 picks, Jan 6–Feb 13 2026, 40W/10L, 37A/10B/3C |
| Determinism hash | `dabe21940b91082ea2926d3499874dc1eb571885e5aab239767049920e3c844c` |
| Gate 1 | PASS — 200 events, 50 picks, 0 errors |
| Gate 2 | PASS — flat-unit 36 bets, kelly-025-nba-only 6 bets (corr limits correct) |
| Gate 3 | PASS — identical hash, two independent runs |
| Gate 4 | PASS — $9,043.82 final, 9.56% drawdown, no crash |
| Summary | `out/utv2-320-simulation-summary.json` |
