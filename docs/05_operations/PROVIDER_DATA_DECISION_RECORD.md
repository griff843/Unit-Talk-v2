# Provider & Data Decision Record

**Status:** RATIFIED — 2026-04-01
**Authority:** T1 strategic decision record. Owned by PM (A Griffin).
**Cross-references:** `CONTROLLED_VALIDATION_PACKET.md`, `production_readiness_checklist.md` §7–§8, `T1_PROVIDER_INGESTION_CONTRACT.md`, `MODEL_REGISTRY_CONTRACT.md`

---

## 1. Decision Summary

Unit Talk V2 is entering controlled validation. Before that phase can produce meaningful evidence, the provider and data strategy must be locked. This record defines:

- Which providers serve which data domains
- What is canonical for edge, settlement, CLV, recap, and future modeling
- What the spend model is
- Whether the claimed "math is done, gap is plumbing" is actually true

**Top-line verdict on the "math is done" claim: PARTIALLY PROVEN.**

The claim is true for the **submission-to-settlement core** (devigging, Kelly, CLV, real edge, scoring profiles). It is false for **five domain modules** that exist as tested code with zero runtime consumers — calibration, risk engine, market signals, band assignment, and strategy evaluation. The remaining gap is not "mostly plumbing." It is plumbing for the live path, but nontrivial intellectual design work remains for operationalizing the dead modules, building the CLV feedback loop, and wiring market signals into the uniqueness score. See Section 10 for the full challenge analysis.

---

## 2. Evaluation Criteria

Every provider option is scored against these dimensions:

| Criterion | Weight | Definition |
|-----------|--------|------------|
| Live pricing richness | High | Breadth of markets, lines, and props returned per event |
| Prop coverage | High | Player prop depth (stat types, sports, alternate lines) |
| Settlement reliability | Critical | Trustworthiness and completeness of game results for grading |
| Historical depth | Medium | Ability to fetch past odds snapshots for CLV benchmarking and backtesting |
| Backfill suitability | Medium | Can we re-ingest historical data to seed models? |
| Latency | Medium | Time from external API to `provider_offers` row insertion |
| Cost structure | High | Credit/request model, predictability, monthly spend at target volume |
| Schema fit | Medium | How well raw data maps to `NormalizedProviderOffer` contract |
| Auditability / replay | Medium | Can we reconstruct the exact odds state at any historical point? |
| Value toward Section 7 | High | Does it close Elite Production Gate items? |
| Value toward Section 8 | Medium | Does it advance Syndicate Gate items? |

---

## 3. Current-State Reality Check

### 3.1 What is deployed and running

| System | State | Evidence |
|--------|-------|----------|
| SGO odds ingest | **Live** | `apps/ingestor` polls every 5 min; `providerKey: 'sgo'` |
| SGO results ingest | **Live** | Grading triggers after each results cycle |
| Odds API ingest | **Deployed, optional** | Requires `ODDS_API_KEY`; `providerKey: 'odds-api:{book}'` |
| Odds API historical | **Code exists** | `fetchOddsApiHistorical()` — not called in any scheduled path |
| Real edge service | **Live** | Priority chain: Pinnacle → consensus → SGO → confidence-delta |
| CLV service | **Live** | Reads Pinnacle closing line from `provider_offers` |
| Grading service | **Live** | Automated from SGO `game_results` |
| Promotion service | **Live** | 5-score evaluation, reads real edge + Kelly + trust |

### 3.2 What is NOT running

| Component | State | Detail |
|-----------|-------|--------|
| Odds API key | **Unknown** | Env var `ODDS_API_KEY` may or may not be set in production |
| Pinnacle data in DB | **Unverified** | If Odds API key is not set, zero Pinnacle rows exist. CLV and real edge silently degrade. |
| Provider health monitoring | **Absent** | No operator visibility into ingest health, credits, or data freshness |
| Budget enforcement | **Absent** | Credits tracked in telemetry but not capped or alarmed |
| Backup results source | **Absent** | If SGO results fail, grading stops |

### 3.3 Critical unknown

> **We do not know whether Pinnacle data currently exists in the production `provider_offers` table.**

If `ODDS_API_KEY` is not configured in production:
- `realEdge` falls back to confidence-delta on 100% of picks
- CLV uses SGO closing line only (less accurate)
- Consensus probability is unreachable
- The entire Sprint D intelligence layer is inert

**This must be verified as a Day 0 burn-in entry condition.**

---

## 4. Canonical Data Map

This table locks which provider is canonical for each data domain. Changes require PM approval.

| Data Domain | Canonical Provider | Fallback | Stored Where | Consumer |
|-------------|-------------------|----------|--------------|----------|
| **Edge inputs** (market probability) | Odds API → Pinnacle (devigged) | Odds API → consensus (DK/FD/MGM avg) → SGO → confidence-delta | `provider_offers` → `picks.metadata.realEdge` | `real-edge-service.ts` → `promotion-service.ts` |
| **CLV inputs** (closing line) | Odds API → Pinnacle (last snapshot before game start) | SGO (if no Pinnacle) → null | `provider_offers` → `settlement_records.payload.clvPercent` | `clv-service.ts` |
| **Settlement truth** (game results) | SGO results feed | None (manual settlement) | `game_results` | `grading-service.ts` |
| **Recap truth** | Derived from settlement records | — | `settlement_records` | `recap-service.ts` |
| **Historical / training truth** | Odds API historical endpoint + `provider_offers` snapshots | SGO snapshots (current only) | `provider_offers` (temporal) | Not yet consumed |
| **Shadow validation baseline** | Not assigned — no shadow system exists | — | — | — |

### Canonical rules

1. **Pinnacle is the sharp benchmark.** All devig-dependent computations (edge, CLV) prefer Pinnacle data when available.
2. **SGO is the settlement authority.** Game results come only from SGO. If SGO results are unavailable, picks remain in `posted` state until manual intervention.
3. **Consensus requires ≥2 books.** The real-edge-service enforces this minimum. Single-book fallback produces `sgo-edge`, not `consensus-edge`.
4. **Confidence-delta is the last resort.** It is not market edge — it is the capper's self-assessed edge. Any system claiming "real edge" while running on confidence-delta is producing a misleading metric.

---

## 5. Provider Option Analysis

### 5.1 SGO (Sports Game Odds)

| Criterion | Score | Notes |
|-----------|-------|-------|
| Live pricing richness | 7/10 | Moneyline, spreads, totals, 13 player prop types |
| Prop coverage | 8/10 | Strong NBA/NFL/MLB/NHL player props |
| Settlement reliability | **9/10** | Only results source currently; proven in production |
| Historical depth | 2/10 | No historical endpoint; only current snapshot |
| Backfill suitability | 2/10 | Cannot re-fetch past odds |
| Latency | 7/10 | 2–10s per cycle; 5-min poll interval |
| Cost structure | 6/10 | Credit-based, variable cost per call; telemetry tracked |
| Schema fit | 8/10 | Good fit to `NormalizedProviderOffer`; `sgo-normalizer.ts` handles mapping |
| Auditability | 5/10 | Snapshots timestamped but no guaranteed replay |
| Section 7 value | **High** | Closes 7.4 (partial), 7.5, 7.6 (CLV fallback) |
| Section 8 value | Medium | Props data useful; lacks multi-book consensus |

**Role: Primary odds + results provider. Settlement authority.**

### 5.2 The Odds API

| Criterion | Score | Notes |
|-----------|-------|-------|
| Live pricing richness | 8/10 | Multi-book odds (Pinnacle, DK, FD, MGM); h2h, spreads, totals |
| Prop coverage | 5/10 | Player props via description matching (less structured than SGO) |
| Settlement reliability | 3/10 | Scores endpoint exists; not wired to grading |
| Historical depth | **8/10** | Historical odds endpoint for any past date; 1 credit per fetch |
| Backfill suitability | **8/10** | Can seed historical Pinnacle lines for CLV backtesting |
| Latency | 7/10 | 2–10s per cycle; 5-min poll interval |
| Cost structure | 7/10 | Request-based (per-API-call credits); `x-requests-remaining` tracked |
| Schema fit | 7/10 | Good after UTV2-249 moneyline normalization |
| Auditability | **9/10** | Historical endpoint enables point-in-time replay |
| Section 7 value | **High** | Closes 7.4 (second provider), enables real edge for 7.11 |
| Section 8 value | **High** | Pinnacle sharp line for CLV, multi-book for consensus (8.1 partial, 8.6, 8.8) |

**Role: Sharp benchmark (Pinnacle) + multi-book consensus source.**

### 5.3 Provider 3 (not yet integrated)

To reach Section 8.1 ("≥3 odds providers with real-time consensus"), a third source would be needed. Options:

| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| Pinnacle WebSocket (direct) | Sub-second latency; sharpest line | Requires account + partnership; complex integration | High (4+ weeks) |
| SBR / Sharp Sports feed | Real-time push; multi-book | Commercial license; non-trivial cost | High (3+ weeks) |
| ESPN/Gracenote (results only) | Settlement redundancy | No odds data | Medium (2 weeks) |

**Decision: No third provider during burn-in.** Two-provider consensus is sufficient for controlled validation. Third provider is a Phase 7 / Syndicate Gate concern.

---

## 6. Math / Intellectual Layer Challenge

This section directly tests the claim made in Section 8 of the production readiness checklist:

> "The domain math required for syndicate operation (Kelly, CLV, devig, edge, calibration) is already done in V2 and is more rigorous than legacy. The remaining gap is data plumbing and automation — not new intellectual work."

### 6.1 Status taxonomy

For each component, we distinguish six levels of maturity:

| Level | Meaning |
|-------|---------|
| **Implemented in code** | Source file exists in `packages/domain/` or `apps/api/` |
| **Tested** | Unit tests pass in `pnpm test` |
| **Contract-authorized** | A ratified T1 contract defines the component's behavior |
| **Live in DB / runtime** | Code runs in production, reads or writes to database |
| **Broadly consumed** | Multiple downstream services or surfaces use the output |
| **Merely documented** | Only exists in docs or contracts; no matching runtime code |

### 6.2 Component-by-component challenge

| Component | In code | Tested | Contract | Live in runtime | Broadly consumed | Documented |
|-----------|---------|--------|----------|-----------------|------------------|------------|
| Devigging (proportional) | ✅ | ✅ | ✅ | ✅ submission + CLV | ✅ edge score + devig result + CLV | ✅ |
| Kelly fraction | ✅ | ✅ | ✅ | ✅ submission-time | ⚠️ stored in metadata; readiness gradient in promotion; NOT in Discord embeds or member UI | ✅ |
| CLV computation | ✅ | ✅ | ✅ | ✅ settlement-time | ✅ operator stats + capper trust feedback | ✅ |
| Real edge (vs market) | ✅ | ✅ | ✅ | ✅ submission-time | ✅ primary edge score driver in promotion | ✅ |
| EdgeSource tracking | ✅ | ✅ | ✅ | ✅ promotion snapshot | ⚠️ stored, not yet surfaced in operator UI | ✅ |
| Consensus probability | ✅ | ✅ | ✅ | ⚠️ indirect via real-edge-service averaging | ⚠️ only as intermediate to realEdge | ✅ |
| Calibration metrics | ✅ | ✅ | ✅ | ❌ **zero runtime consumers** | ❌ | ✅ |
| Risk engine | ⚠️ Kelly only | ✅ | ✅ | ⚠️ Kelly only | ⚠️ Kelly only | ✅ |
| Market signals / book dispersion | ✅ | ✅ | ✅ | ❌ **zero runtime consumers** | ❌ | ✅ |
| Band assignment | ✅ | ✅ | ⚠️ | ❌ **zero runtime consumers** | ❌ | ✅ |
| Strategy evaluation | ✅ | ✅ | ⚠️ | ❌ **zero runtime consumers** | ❌ | ✅ |
| Walk-forward backtesting | ✅ | ✅ | — | ❌ **no scheduled runs** | ❌ | — |
| Uniqueness score | ❌ hardcoded to 50 | — | — | ❌ **always returns 50** | ❌ meaningful signal | — |

### 6.3 What the claim gets right

The submission-to-settlement core pipeline genuinely works:
- Pick submitted → devig + Kelly + real edge computed → promotion scored → outbox enqueue → delivery → settlement → CLV computed → capper trust adjusted.
- This is **live, tested, and broadly consumed**.
- The math in this path is correct and more rigorous than legacy.

### 6.4 What the claim gets wrong

Five domain modules exist only as tested code with **zero runtime consumers** in any app:

1. **Calibration** (`packages/domain/src/probability/calibration.ts`) — Brier score, ECE, MCE, log loss, reliability buckets. Not imported by any file in `apps/`. No consumer. Dead code.

2. **Market signals / book dispersion** (`packages/domain/src/signals/`) — Movement score, disagreement score, sharp-retail delta, signal vector computation. Not imported by any file in `apps/`. The `uniqueness` score in `promotion-service.ts` is hardcoded to `50` (line 617) — the market signal infrastructure that was supposed to feed it is not wired.

3. **Band assignment** (`packages/domain/src/bands/`) — Complete band tier system with downgrade logic. Not imported by any file in `apps/`. The promotion system uses a 5-component weighted model instead, with no band integration.

4. **Strategy evaluation** (`packages/domain/src/strategy/`) — Full `StrategyEvaluationEngine`, `ExecutionSimulator`, `BankrollSimulator`. Not imported by any file in `apps/`. Only used in golden regression tests.

5. **Walk-forward backtesting** (`packages/domain/src/clv-weight-tuner.ts`) — `runWalkForwardBacktest()`, `testAllComponentSignificance()`. Not called by any scheduled job or runtime path. Scoring profile weights are static.

### 6.5 What requires nontrivial intellectual design (not just plumbing)

| Work item | Why it's not "just plumbing" |
|-----------|------------------------------|
| Wiring market signals → uniqueness score | Requires deciding what signal vector means for uniqueness (novel board composition? line movement contra-indicator? market disagreement?). Currently hardcoded to 50. No contract defines this. |
| CLV feedback → scoring weight adjustment | The walk-forward backtesting infrastructure exists but has never run. Deciding when and how to adjust weights from evidence is a statistical design problem, not a plumbing problem. |
| Calibration operationalization | Running Brier/ECE on live predictions requires defining: which predictions, what outcome window, what threshold triggers recalibration, who acts on the result. |
| Risk engine beyond Kelly | Kelly fraction is live. Bankroll-aware position sizing, exposure correlation caps, and daily loss limits require risk policy design — not just wiring. |
| Band system integration decision | The band system and the 5-score weighted system are two different approaches to pick quality assessment. Deciding whether to integrate, replace, or deprecate bands is a design decision. |

---

## 7. Final Provider Recommendations

### Primary provider: SGO

**Role:** Odds + props + settlement results.
**Sports:** NBA, NFL, MLB, NHL.
**Markets:** Moneyline, spreads, totals, 13 player prop types.
**Settlement authority:** Yes — sole source of `game_results` for automated grading.
**Budget implication:** Existing subscription + credit consumption. Must track credits per cycle.

### Secondary / benchmark provider: The Odds API

**Role:** Pinnacle sharp line + multi-book consensus for edge and CLV.
**Bookmakers:** Pinnacle (primary benchmark), DraftKings, FanDuel, BetMGM.
**Markets:** h2h, spreads, totals (player props available but less structured).
**CLV authority:** Pinnacle closing line is the CLV benchmark.
**Edge authority:** Pinnacle devigged probability is the primary market edge comparator.
**Budget implication:** Request-based credits. Must monitor `x-requests-remaining`.

### Historical / backfill provider: The Odds API (historical endpoint)

**Role:** Seed historical Pinnacle closing lines for CLV backtesting.
**Cost:** 1 credit per historical fetch.
**Priority:** Low during burn-in. Valuable for Phase 7 CLV optimization analysis.

### Results backup provider: Not assigned

**Risk accepted:** SGO is the sole results source. If SGO results feed fails, grading pauses until manual intervention or SGO recovery. A backup source (ESPN, Gracenote) is recommended for Phase 7 but not required for controlled validation.

---

## 8. Spend Model and Usage Guardrails

### 8.1 Current consumption model

| Provider | Unit | Estimated per cycle | Cycles/day (5-min) | Daily estimate | Monthly estimate |
|----------|------|--------------------|--------------------|----------------|-----------------|
| SGO | Credits (variable) | ~1–2 credits × 4 leagues | 288 | 1,150–2,300 credits | 34,500–69,000 credits |
| Odds API | Requests (fixed) | 1 request × 4 leagues = 4 | 288 | 1,152 requests | 34,560 requests |

**Note:** These are rough estimates. Actual consumption depends on tier, number of events per league, and prop endpoints fetched.

### 8.2 Guardrails (recommended)

| Guardrail | Rule | Implementation |
|-----------|------|----------------|
| Daily credit cap (SGO) | Alert at 80% of daily budget; pause at 100% | Not implemented — requires new logic in ingestor |
| Daily request cap (Odds API) | Alert at 80% of monthly allocation / 30; pause at 100% | Not implemented — `creditsRemaining` tracked but not enforced |
| Ingest failure alarm | If 3 consecutive cycles fail for any provider, alert operator | Not implemented — circuit breaker exists but doesn't notify |
| Stale data alarm | If `provider_offers` has no rows newer than 30 min, alert | Not implemented |
| Spend dashboard | Operator-visible view: credits used today, remaining, burn rate | Not implemented |

**Burn-in stance:** All five guardrails are **absent**. During burn-in, monitor credits manually from ingestor logs. Implementation is recommended before Phase 7.

### 8.3 Budget authorization

| Item | Decision |
|------|----------|
| SGO subscription tier | Use current tier. If credit consumption exceeds plan, flag to PM before upgrading. |
| Odds API plan | Use current plan. Monitor `x-requests-remaining` daily during burn-in. |
| Historical backfill budget | Defer. Do not run historical backfill during burn-in unless PM explicitly authorizes credit spend. |
| Third provider evaluation | Defer to Phase 7. No spend authorized. |

---

## 9. Burn-In Implications

This decision record shapes the controlled validation phase in these ways:

### 9.1 Day 0 verification required

Before burn-in clock starts, these must be true:

| Check | Why | How to verify |
|-------|-----|---------------|
| `ODDS_API_KEY` is configured in production | Without it, zero Pinnacle data, zero real edge, CLV degrades to SGO-only | Check env; query `SELECT DISTINCT provider_key FROM provider_offers` |
| Pinnacle rows exist in `provider_offers` | Proves Odds API ingest is actually running | `SELECT count(*) FROM provider_offers WHERE provider_key = 'odds-api:pinnacle' AND created_at > now() - interval '24h'` |
| SGO results inserting | Proves grading automation can fire | `SELECT count(*) FROM game_results WHERE created_at > now() - interval '24h'` |
| Multi-book rows exist | Proves consensus path is reachable | `SELECT DISTINCT provider_key FROM provider_offers WHERE provider_key LIKE 'odds-api:%'` |

### 9.2 Evidence this record requires from burn-in

| Evidence | Purpose |
|----------|---------|
| Edge source distribution (real-edge vs confidence-delta) | Proves whether Pinnacle data is actually reaching the promotion scorer |
| CLV populated rate | Proves whether Pinnacle closing lines are available at settlement time |
| Provider row counts by `provider_key` per day | Proves both providers are ingesting consistently |
| Credit/request consumption log | Validates spend estimates in Section 8.1 |
| Grading completion rate | Proves SGO results feed is reliable as sole settlement source |

### 9.3 What burn-in CANNOT prove about providers

| Gap | Why | Resolution |
|-----|-----|------------|
| Provider resilience under outage | Burn-in is 3-7 days; unlikely to see a multi-hour outage | Accept risk; monitor; plan backup source for Phase 7 |
| Real-time consensus accuracy | Polling at 5-min intervals is not real-time; cannot measure sub-minute market movements | Accept for controlled validation; streaming feed required for Syndicate Gate |
| Historical CLV accuracy vs Pinnacle direct | Pinnacle data comes through Odds API, not Pinnacle direct; may differ from Pinnacle's own API | Accept — Odds API Pinnacle is the closest available proxy |

---

## 10. Final Verdict on the "Math Is Done, Gap Is Plumbing" Claim

### The claim under test

From `production_readiness_checklist.md`, Section 8 note:

> "The domain math required for syndicate operation (Kelly, CLV, devig, edge, calibration) is already done in V2 and is more rigorous than legacy. The remaining gap is data plumbing and automation — not new intellectual work."

### Verdict: PARTIALLY PROVEN

The claim is evaluated against three tiers:

#### Tier 1: Section 7 (Elite Production) — **Math is sufficient**

The math layer for Elite Production is functional. Devigging, Kelly, CLV, real edge, and scoring profiles are live, tested, and wired to runtime consumers. The core submission → promotion → delivery → settlement → CLV pipeline works end-to-end. The remaining Section 7 gaps are genuinely operational (channel activation, bot commands, analytics dashboard) — not mathematical.

**Tier 1 ruling: CLAIM IS PROVEN for Section 7.**

#### Tier 2: Section 8 (Syndicate Gate) — **Math is partially built, partially dead, partially missing**

| Section 8 item | Math needed | Math state | Remaining work type |
|----------------|------------|------------|---------------------|
| 8.1 ≥3 providers real-time consensus | Consensus averaging | Implemented (averaging in real-edge-service) | Plumbing (third provider integration) |
| 8.2 CLV optimization loop | CLV feedback → weight adjustment | Walk-forward exists, never run | **Design** (when to run, what thresholds trigger weight changes) |
| 8.3 Kelly signals surfaced per pick | Kelly computation | Live in metadata | Plumbing (surface in Discord embed) |
| 8.4 Hedge detection + routing | Hedge detection | Contract only; code exists in DB schema | Plumbing + minor design |
| 8.5 Line movement alerts <60s | Movement detection | Alert agent exists; latency unknown | Plumbing (streaming feed needed) |
| 8.6 Multi-book consensus → elevated edge | Disagreement/signal scoring | **Dead code** in `packages/domain/src/signals/` | **Design** (what signal means, how it routes, what threshold triggers) |
| 8.7 Risk engine active | Bankroll-aware sizing | Kelly only; no exposure caps, no correlation | **Design** (risk policy, exposure model, drawdown rules) |
| 8.8 Devig + consensus per pick | Devig + consensus | Live (devig); consensus partial | Plumbing (ensure Odds API data coverage) |
| 8.9 Historical CLV by capper | CLV per pick | Live | Plumbing (aggregation surface) |
| 8.10 Shadow mode validation | Simulation mode | Live | Plumbing (shadow framework per checklist) |
| 8.11 Golden test suite | Regression testing | 2 golden scenarios exist | Plumbing (expand coverage) |
| 8.12 Temporal orchestration | Workflow engine | Deferred | **Design + plumbing** (architectural decision) |

**Tier 2 ruling: CLAIM IS PARTIALLY PROVEN for Section 8.**

- 5 of 12 items require only plumbing
- 4 of 12 items require nontrivial design decisions
- 3 of 12 items are mixed plumbing + design
- 5 domain modules are dead code (calibration, market signals, bands, strategy, walk-forward scheduler)

#### Tier 3: The "more rigorous than legacy" sub-claim

This sub-claim is **not testable** without legacy V1 comparison data. V1 was found to contain only synthetic data (UTV2-172). We cannot compare V2's mathematical rigor against V1's because V1 never ran against real data at scale. The sub-claim may be true but it is **unverifiable and should be dropped from official status documents**.

### Summary ruling

| Scope | Verdict |
|-------|---------|
| Section 7 (Elite Production) | **PROVEN** — math is sufficient; remaining gaps are operational |
| Section 8 (Syndicate Gate) | **PARTIALLY PROVEN** — core math live; 5 modules dead; 4 items need design, not just plumbing |
| "More rigorous than legacy" | **UNVERIFIABLE** — V1 synthetic data makes comparison impossible |
| "Remaining gap is data plumbing" | **MATERIALLY INCOMPLETE** — plumbing is the majority of remaining work, but 4+ items require genuine design decisions that cannot be dismissed as automation |

---

## 11. Recommended Next Actions

### Before burn-in starts (Day 0 blockers)

| # | Action | Owner | Why |
|---|--------|-------|-----|
| 1 | Verify `ODDS_API_KEY` is set in production env | PM / Ops | Without it, the entire Sprint D intelligence layer is inert |
| 2 | Query `provider_offers` for Pinnacle rows | Claude (verification lane) | Proves Odds API ingest is actually running |
| 3 | Query `game_results` for recent rows | Claude (verification lane) | Proves SGO results are feeding grading |
| 4 | Confirm ingestor is running with `UNIT_TALK_INGESTOR_AUTORUN=true` | PM / Ops | Without it, no data flows |

### During burn-in

| # | Action | Owner | Why |
|---|--------|-------|-----|
| 5 | Log edge source distribution daily | Claude (burn-in lane) | Measures real-edge vs confidence-delta rate |
| 6 | Log Odds API `x-requests-remaining` daily | Claude (burn-in lane) | Tracks spend against plan |
| 7 | Log provider row counts per `provider_key` daily | Claude (burn-in lane) | Verifies both providers ingesting |
| 8 | Spot-check CLV against actual Pinnacle closing line | Claude (burn-in lane) | Validates CLV accuracy |

### After burn-in (Phase 7 prep)

| # | Action | Owner | Why |
|---|--------|-------|-----|
| 9 | Decide: integrate or deprecate band system | PM (design decision) | Band system is dead code; must commit to a direction |
| 10 | Decide: wire market signals → uniqueness score, or accept hardcoded 50 | PM (design decision) | Uniqueness is meaningless at 50 for all picks |
| 11 | Decide: operationalize walk-forward backtesting or defer | PM (design decision) | Scoring weights have never been validated against outcomes |
| 12 | Decide: calibration module — wire to runtime or deprecate | PM (design decision) | Dead code that should either earn its keep or be removed |
| 13 | Evaluate third provider for streaming odds | PM (strategic) | Required for Section 8.1; 3-provider real-time consensus |
| 14 | Evaluate backup results source (ESPN/Gracenote) | PM (operational) | SGO is single point of failure for settlement |

### Update required in production_readiness_checklist.md

The following items should be updated from ⬜ to reflect actual state discovered by this audit:

| Item | Current | Should be |
|------|---------|-----------|
| 4.6 Line movement detection | ⬜ | ✅ (alert agent deployed) |
| 4.9 Odds provider 2 integrated | ⬜ | ✅ (Odds API deployed) |
| 4.11 API quota tracking | ⬜ | ✅ (telemetry captured per request) |
| 4.12 Circuit breaker (odds API) | ⬜ | ✅ (circuit breaker in ingestor) |
| 7.4 Live odds from ≥2 providers | ⬜ | ✅ (SGO + Odds API deployed; verify data exists) |
| 8.8 Automated devig + consensus per pick | ⬜ | ⚠️ (devig live; consensus conditional on Odds API data) |

---

## Risk Table

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Odds API key not configured → intelligence layer inert | **Critical** | Unknown | Day 0 verification check |
| SGO results feed outage → grading stops | High | Low (5-min polling) | Accept during burn-in; backup source in Phase 7 |
| Odds API credit exhaustion → Pinnacle data stops | Medium | Low | Monitor `x-requests-remaining` daily |
| Pinnacle data sparse for some markets → CLV null | Medium | Medium | Log CLV populated rate; accept SGO fallback |
| Uniqueness hardcoded to 50 → promotion scores misleading | Low | **Certain** | Accept during burn-in; design decision in Phase 7 |
| Dead domain modules accumulate tech debt | Low | **Certain** | Phase 7 decision: wire or deprecate each module |
| "Math is done" belief delays necessary design work | Medium | Medium | This document exists to prevent that |

---

## Authority and Update Rule

This document is T1. Provider assignments and canonical data map changes require PM approval.

Updates allowed during burn-in:
- Adding evidence rows from daily verification
- Updating spend actuals vs estimates
- Noting provider incidents

Updates requiring PM approval:
- Changing canonical provider for any data domain
- Authorizing spend on third provider evaluation
- Changing CLV or edge benchmark source
