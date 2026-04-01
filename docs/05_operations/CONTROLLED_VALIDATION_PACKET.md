# Controlled Validation Packet

**Status:** RATIFIED — 2026-04-01
**Authority:** T1 governance artifact. Owned by PM (A Griffin). No code changes required.
**Supersedes:** `PRODUCTION_READINESS_CANARY_PLAN.md` for the current pre-Phase-7 burn-in scope.
**Cross-references:** `production_readiness_checklist.md` §7–§8, `PROGRAM_STATUS.md`, `MODEL_REGISTRY_CONTRACT.md`

---

## 1. Purpose

Unit Talk V2 has completed Sprint D (Intelligence v1). Code is written. Tests pass. Docs are updated.

That is not the same as production-ready.

This packet defines the **controlled validation / burn-in phase** — the formal operational milestone that bridges "done coding" and "authorized to open Phase 7 (Syndicate Lane)." It exists because:

- No real slate days have been run end-to-end under the current system.
- Several intelligence capabilities exist in code and tests but have not been exercised against live data in production conditions.
- The production readiness checklist (Section 8) contains a claim that "the domain math required for syndicate operation is already done." **That claim is a hypothesis, not a proven fact.** This packet defines how to test it.
- Phase 7 cannot begin until there is evidence that the current system behaves correctly under load, not just under unit tests.

The controlled validation phase is **not a feature sprint**. No new code ships during this window unless a kill condition is triggered.

---

## 2. Scope

This packet covers the following system boundary:

```
pick submission → scoring/promotion → outbox enqueue → worker delivery
→ Discord confirmation → settlement → CLV computation → recap → operator review
```

**In scope:**
- All submission paths: Smart Form, Discord `/pick`, API direct
- Promotion evaluation for best-bets and trader-insights policies
- Real edge computation vs confidence-delta fallback
- Outbox delivery to canary, best-bets, trader-insights
- Grading against SGO game results
- CLV computation and operator surface
- Recap posting
- Alert agent line movement detection
- Operator snapshot and command center accuracy

**Out of scope during burn-in:**
- Phase 7 feature work (UTV2-209, 210, 211)
- New channel activation
- Contract changes
- Scoring profile weight changes

---

## 3. Entry Conditions

All must be true before burn-in clock starts:

| # | Condition | How to verify |
|---|-----------|---------------|
| E1 | `pnpm verify` exits 0 | Run `pnpm verify` locally |
| E2 | `pnpm type-check` exits 0 | Run `pnpm type-check` |
| E3 | At least one capper actively submitting real picks | Manual confirmation from PM |
| E4 | SGO ingestor running and inserting rows | `SELECT count(*) FROM provider_offers WHERE created_at > now() - interval '24h'` |
| E5 | Odds API ingestor configured and returning data | Check `OddsApiIngestSummary.status === 'succeeded'` in ingestor logs |
| E6 | Worker process running with `UNIT_TALK_WORKER_AUTORUN=true` | Operator snapshot `workerRuntime.status === 'healthy'` |
| E7 | Operator snapshot accessible | `GET /api/operator/snapshot` returns 200 |
| E8 | Command center accessible | Next.js app at port 4300 returns 200 |
| E9 | At least one Discord delivery confirmed in canary in last 24h | Check `distribution_receipts` for `target_key = 'discord:canary'` and `status = 'sent'` |

If any entry condition is not met, burn-in does not start. Fix the gap first.

---

## 4. Burn-In Duration

**Minimum:** 3 real slate days (days when at least 2 picks are submitted, promoted, and settled).
**Target:** 7 calendar days.
**Clock restart triggers:** Any kill condition hit (see Section 11).

A "real slate day" requires:
- At least 2 picks submitted with real picks data (not test fixtures)
- At least 1 pick promoted and delivered to Discord
- At least 1 pick settled with grading result recorded
- SGO ingest run at least once

---

## 5. Daily Validation Checklist

Run this checklist at end of each slate day. Log results in `out/controlled-validation/daily/{date}.md`.

### 5.1 Submission and Scoring

| Check | Pass condition | Actual | Notes |
|-------|----------------|--------|-------|
| Picks submitted today | ≥ 1 | | |
| Submission events recorded | `submission_events` rows exist for each pick | | |
| Domain analysis computed | `metadata.domainAnalysis` present on submitted picks | | |
| Devig result attached | `metadata.deviggingResult` present when provider offer matched | | |
| Kelly sizing attached | `metadata.kellySizing` present on picks with confidence | | |
| Real edge computed | `metadata.domainAnalysis.realEdge` present on ≥1 pick | | |
| Edge source recorded | `promotionDecision.scoreInputs.edgeSource` present in pick metadata | | |
| Edge source distribution | Count of `real-edge` vs `confidence-delta` vs other sources today | | |

### 5.2 Promotion and Delivery

| Check | Pass condition | Actual | Notes |
|-------|----------------|--------|-------|
| Picks evaluated by promotion gate | `pick_promotion_history` rows exist | | |
| Picks promoted (qualified) | At least 1 `qualified` row today | | |
| Outbox rows created | `distribution_outbox` rows in `pending` or later | | |
| Picks delivered to Discord | `distribution_receipts` with `status = 'sent'` | | |
| Duplicate deliveries | 0 duplicate outbox_id per target | | |
| Dead-letter rows | 0 `dead_letter` status rows | | |
| Failed rows that recovered | Count of retried rows | | |
| Discord channels confirmed live | Manual check: canary + best-bets + trader-insights | | |

### 5.3 Grading and Settlement

| Check | Pass condition | Actual | Notes |
|-------|----------------|--------|-------|
| Game results ingested | `game_results` rows exist for today's slate | | |
| Grading pass ran | `POST /api/grading/run` completed without error | | |
| Picks graded | Settlement records created for eligible picks | | |
| Settlement completion rate | ≥80% of eligible graded picks settled | | |
| CLV computed | `clvRaw` and `clvPercent` populated on settled picks | | |
| CLV `beatsClosingLine` recorded | Boolean present on settled picks with closing line | | |
| CLV source recorded | `providerKey` on CLV (sgo / odds-api / etc.) | | |

### 5.4 Recap and Operator

| Check | Pass condition | Actual | Notes |
|-------|----------------|--------|-------|
| Recap posted | Settlement recap fired to Discord after grading | | |
| Operator snapshot accurate | Snapshot counts match direct DB queries | | |
| Operator interventions needed | Count of manual interventions today | | |
| Alert agent ran | `runAlertDetectionPass()` completed | | |
| Line movement alerts fired | Count (0 is acceptable if no qualifying movement) | | |
| Command center rendering correct data | Visual check of dashboard picks/stats | | |

### 5.5 Incidents and Verdict

| Field | Value |
|-------|-------|
| Incidents today | |
| Surprises (unexpected behavior) | |
| Kill condition triggered? | Yes / No |
| Daily verdict | **PASS / CONDITIONAL / FAIL** |

---

## 6. Evidence Requirements

The following artifacts must exist and be complete before burn-in exit:

| Artifact | Format | Location | Required by |
|----------|--------|----------|-------------|
| Daily checklist logs | Markdown | `out/controlled-validation/daily/{date}.md` | Each slate day |
| Grading spot-check log | Markdown (pick ID, expected, actual, source URL) | `out/controlled-validation/grading_spotcheck.md` | ≥10 spot-checks |
| CLV verification log | Markdown (pick IDs, clvRaw, clvPercent, manual check vs provider) | `out/controlled-validation/clv_verification.md` | ≥5 picks |
| Edge source distribution | JSON query result: count by `edgeSource` over burn-in period | `out/controlled-validation/edge_source_dist.json` | At exit |
| Real edge proof | At least 1 pick where `realEdge` is present and differs from `confidenceDelta` | `out/controlled-validation/real_edge_proof.md` | Before exit |
| Operator snapshot exports | JSON from `GET /api/operator/snapshot` | `out/controlled-validation/snapshots/{date}.json` | Each day |
| DB reconciliation | Direct query vs snapshot for picks, outbox, receipts | `out/controlled-validation/db_reconciliation.md` | ≥3 spot-checks |
| Math layer proof bundle | See Section 9 | `out/controlled-validation/math_layer_proof.md` | Before exit |
| Sign-off record | PM explicit verdict | `out/controlled-validation/signoff.md` | At exit |

---

## 7. Production Gate Scorecard — Section 7 (Elite Production Gate)

Score each criterion against burn-in evidence. Do not accept checklist status at face value.

| # | Criterion | Checklist status | Burn-in test | Evidence required |
|---|-----------|-----------------|--------------|-------------------|
| 7.1 | All 6 Discord channels live | ⬜ | OUT OF SCOPE — not required for burn-in | N/A |
| 7.2 | Full Discord bot command suite (30+) | ⬜ | OUT OF SCOPE | N/A |
| 7.3 | Capper tier system live | ⬜ | PARTIAL — `member_tiers` table live, Discord role auto-revoke not implemented | Log tier assignment in daily check |
| 7.4 | Live odds ingestion from ≥2 providers | ⬜ | **TESTABLE** — SGO + Odds API both deployed | Verify both providers insert rows daily |
| 7.5 | Automated grading + settlement | ⬜ | **TESTABLE** — grading cron live | Record grading pass completion daily |
| 7.6 | CLV tracking live and recorded per pick | ✅ | **VERIFY DOES NOT REGRESS** | CLV verification log |
| 7.7 | Daily/weekly recap automation | ⬜ | **TESTABLE** — scheduler live | Confirm recap posts daily |
| 7.8 | Analytics dashboard live | ⬜ | PARTIAL — Command Center live but some sections incomplete | Visual check + flag broken sections |
| 7.9 | Alert system live (line movement + hedge) | ⬜ | **TESTABLE** — alert agent deployed | Confirm `runAlertDetectionPass()` runs daily |
| 7.10 | Temporal workflows | ❌ | Deferred — cron-based workflows accepted at this gate | N/A |
| 7.11 | All domain math consumers wired to live data | ⬜ | **PRIMARY BURN-IN OBJECTIVE** — see Section 9 | Math layer proof bundle |
| 7.12 | `pnpm verify` green with ≥800 tests | ⬜ | Run at burn-in entry and exit | Green at both checkpoints |

**7.11 is the central question of this burn-in.** The current state is: domain math exists in code and passes tests. Whether it is correctly wired to live data, affecting runtime decisions, and producing plausible results on real picks is **unproven**.

---

## 8. Syndicate Gate Readiness Mapping — Section 8

The production readiness checklist (Section 8, final note) states:

> "The domain math required for syndicate operation (Kelly, CLV, devig, edge, calibration) is already done in V2 and is more rigorous than legacy. The remaining gap is data plumbing and automation — not new intellectual work."

**This claim must be treated as a hypothesis, not a fact.** The burn-in will either prove or disprove it.

| # | Criterion | Current code reality | What burn-in tests |
|---|-----------|---------------------|---------------------|
| 8.1 | ≥3 odds providers with real-time consensus | 2 providers deployed (SGO + Odds API); consensus devig partial | Count distinct `provider_key` values in `provider_offers` over burn-in |
| 8.2 | Live CLV optimization loop | `computeAndAttachCLV()` runs at settlement; no alert-on-favorable-close loop | Confirm CLV populates; note optimization loop is absent |
| 8.3 | Kelly-based sizing signals per pick in real-time | Kelly computed at submission, stored in `metadata.kellySizing`; NOT surfaced in Discord embeds | Confirm `kellyFraction` present in metadata; note member-facing surface is missing |
| 8.4 | Hedge detection + routing | Contract ratified; implementation status unknown | Check `hedge_opportunities` table — does it exist and populate? |
| 8.5 | Coordinated line movement alerts (<60s) | Alert agent deployed; latency unverified | Measure time from ingest to alert notification during burn-in |
| 8.6 | Multi-book consensus → elevated edge signal | `real-edge-service.ts` computes consensus edge; `realEdgeSource` recorded | Verify `realEdge` appears in metadata for multi-book picks |
| 8.7 | Risk engine active (bankroll-aware sizing) | Risk engine exists in `packages/domain` — tests pass; NOT wired to any runtime consumer | Confirm: this is test-only. Flag as gap. |
| 8.8 | Automated devig + consensus probability per pick | Devig wired at submission; consensus requires multi-book data | Verify `deviggingResult` in metadata; check whether consensus devig is reached |
| 8.9 | Historical CLV performance tracked by capper | CLV populated on settled picks; operator stats surface reads it | Verify operator `/stats` returns CLV data for graded cappers |
| 8.10 | Shadow mode validation framework | Simulation mode live (`UNIT_TALK_SIMULATION_MODE`); golden tests exist | Confirm simulation mode runs cleanly; note shadow validation framework (5.13) is still ⬜ |
| 8.11 | Golden test suite — all scoring paths | `golden-regression.test.ts` exists; 2 golden scenarios | Verify golden tests pass; flag that coverage is narrow |
| 8.12 | All pipeline stages Temporal-orchestrated | Deferred — cron-based sufficient for Elite, Temporal required for Syndicate | Mark as deferred; document what would trigger the upgrade |

**Assessment of the "math is already done" claim:**

| Component | Code exists? | Tests pass? | Wired to live data? | Affects runtime decisions? | Verdict |
|-----------|-------------|------------|--------------------|-----------------------------|---------|
| Devigging / probability | ✅ | ✅ | ✅ (submission time) | ✅ (promotion scoring) | **PROVEN** |
| Kelly fraction | ✅ | ✅ | ✅ (submission time) | Stored in metadata; NOT surfaced to members | **PARTIAL** |
| CLV computation | ✅ | ✅ | ✅ (settlement time) | ✅ (operator stats) | **PROVEN** |
| Real edge vs market | ✅ | ✅ | ✅ (when market data exists) | ✅ (promotion score driver when edgeSource = real-edge) | **CONDITIONAL** — depends on ingest |
| Calibration | ✅ | ✅ | ❌ — **dead code** | ❌ | **NOT WIRED** |
| Risk engine | ✅ | ✅ | ❌ — no runtime consumer | ❌ | **TEST-ONLY** |
| Market signals / book dispersion | ✅ | ✅ | ❌ — no runtime consumer | ❌ | **TEST-ONLY** |
| Walk-forward backtesting | ✅ | ✅ | ❌ — no scheduled runs | ❌ | **TEST-ONLY** |
| Consensus probability | ✅ | ✅ | ✅ (when ≥2 providers have data) | ✅ (edgeSource = consensus-edge) | **CONDITIONAL** |

**Conclusion about Section 8 claim:** The claim is partially true for the submission/settlement path (devig, CLV, edge, Kelly) but false for calibration, risk engine, market signals, and walk-forward optimization. The "remaining gap is data plumbing" understates the work: several math components are pure test-only with no runtime consumer path.

---

## 9. Math / Intellectual Layer Proof Lane

This section cannot be satisfied by pointing to code or tests. It requires runtime evidence from real picks on real slate days.

### 9.1 Devigging (submission-time)

**Hypothesis:** Every pick submitted with matched provider offer gets a devigged implied probability attached.

**Proof required:**
1. Query: `SELECT id, metadata->>'deviggingResult' FROM picks WHERE created_at > burn-in-start AND metadata ? 'deviggingResult'`
2. Count: what fraction of picks have `deviggingResult`?
3. Verify: for 3 picks manually, confirm `impliedProbability` matches expected devig math for the odds and provider offer used.
4. Flag: what fraction of picks have NO `deviggingResult`? Why? (missing provider offer, timing gap, ingestor not running?)

**Pass condition:** ≥70% of submitted picks have `deviggingResult`. Manual spot-checks correct.

### 9.2 Real Edge (promotion-time)

**Hypothesis:** When market data exists, `realEdge` is computed and `edgeSource` reflects `real-edge` or `consensus-edge` rather than falling back to `confidence-delta`.

**Proof required:**
1. Query: `SELECT metadata->'domainAnalysis'->>'realEdge', metadata->'domainAnalysis'->>'realEdgeSource' FROM picks WHERE created_at > burn-in-start`
2. Distribution: what percentage of picks have a non-null `realEdge`?
3. Verify: for 2 picks with `realEdge` present, trace the source — which provider offer matched? What were the odds? Does the math check out?
4. Query promotion history: `SELECT score_inputs->>'edgeSource' FROM pick_promotion_history WHERE created_at > burn-in-start`
5. Distribution: `real-edge` vs `consensus-edge` vs `confidence-delta` vs other.

**Pass condition:** At least 1 pick with `edgeSource = 'real-edge'` or `'consensus-edge'` proven. At least one manual trace-through verifying the computation is correct.

**Failure condition:** All picks fall back to `confidence-delta` — means market data is not reaching the real-edge computation path. **This is a data plumbing gap, not a math gap.** Must be named explicitly.

### 9.3 Kelly Fraction (submission-time → member surface)

**Hypothesis:** Kelly fraction is computed and stored. It is or is not surfaced to members.

**Proof required:**
1. Query: `SELECT metadata->'kellySizing'->>'kellyFraction' FROM picks WHERE created_at > burn-in-start AND metadata ? 'kellySizing'`
2. Confirm: `kellyFraction > 0` for picks with confidence and valid odds.
3. Check Discord embed: is Kelly fraction visible to members in the pick embed? If not, **document as absent from member surface**.
4. Check Command Center: is Kelly fraction visible to operators? If not, document.

**Pass condition:** Kelly fraction computed on picks with confidence. State of member and operator surface explicitly recorded (present or absent — both are valid outcomes; the point is truth).

### 9.4 CLV Computation (settlement-time)

**Hypothesis:** CLV is computed correctly on graded picks and reflects the actual closing line from the provider.

**Proof required:**
1. Query: `SELECT clv_raw, clv_percent, beats_closing_line FROM settlement_records WHERE created_at > burn-in-start`
2. For 5 settled picks with non-null CLV: manually look up the closing line for that game/market from SGO or public odds source and verify the math.
3. Confirm `beatsClosingLine` is computed correctly (true when `clvRaw > 0`).
4. Log the `providerKey` source used for each CLV computation.

**Pass condition:** CLV present on ≥80% of picks with closing line data. Manual spot-checks confirm correct values.

### 9.5 Calibration (dead code audit)

**Hypothesis:** Calibration is dead code — it exists in `packages/domain` but is not wired to any runtime consumer.

**Proof required:**
1. Grep: `grep -r "calibration\|calibrate\|CalibrationResult" apps/ --include="*.ts" | grep -v test | grep -v ".d.ts"`
2. If grep returns results: trace each usage to see if it affects runtime decisions.
3. If no results: confirm calibration is test-only and document.

**Pass condition (for this proof lane):** Truth is stated explicitly, whatever it is. "Calibration is test-only, not wired to runtime" is a valid pass. Denial or silence is not.

### 9.6 Risk Engine (runtime consumer audit)

**Hypothesis:** The risk engine exists as tested domain logic but has no runtime consumer.

**Proof required:**
1. Grep: `grep -r "riskEngine\|runRiskEngine\|computeRisk\|RiskResult" apps/ --include="*.ts" | grep -v test | grep -v ".d.ts"`
2. If no results: confirm test-only.

**Pass condition:** Truth stated explicitly.

### 9.7 Walk-Forward Backtesting (operationalization audit)

**Hypothesis:** Walk-forward backtesting infrastructure exists in `packages/domain/src/clv-weight-tuner.ts` but is not scheduled or operationalized.

**Proof required:**
1. Confirm `runWalkForwardBacktest()` and `testAllComponentSignificance()` exist in domain.
2. Grep for invocations in apps or scheduled jobs.
3. Confirm no scheduled run exists.

**Pass condition:** Explicitly state: "walk-forward backtesting is test-only. No scheduled runs exist. Scoring profile weights are static. No weight adjustment has been made from evidence."

---

## 10. Incident Taxonomy

Log every incident using this taxonomy. Each incident gets a row in `out/controlled-validation/incidents.md`.

| Category | Examples |
|----------|---------|
| **P0 — Kill condition** | Duplicate delivery, incorrect grading, snapshot lying, dead-letter accumulation |
| **P1 — Data gap** | Pick missing deviggingResult, CLV not populating, real edge falling back 100% |
| **P2 — Surface gap** | Command center section blank, operator stat wrong, Kelly not visible to members |
| **P3 — Performance** | Delivery latency >2min, alert latency >60s, ingest cycle failing |
| **P4 — Observability** | Log missing, audit row missing, correlation ID absent |

Incident log format:
```
Date: YYYY-MM-DD
Category: P0 / P1 / P2 / P3 / P4
Description: [what happened]
Root cause: [identified or unknown]
Resolution: [fix applied or deferred]
Clock restart: [yes/no]
```

---

## 11. Kill Conditions

Any of these immediately halts burn-in. The clock resets when the condition is resolved and verified.

| # | Condition | Action |
|---|-----------|--------|
| K1 | Duplicate Discord delivery detected | Stop. Fix idempotency. Verify fix. Restart clock. |
| K2 | Grading outcome incorrect on spot-check | Stop. Fix grading logic. Re-verify. Restart clock. |
| K3 | Dead-letter rows accumulate (>2 in 24h) | Stop. Investigate. Fix delivery path. Restart clock. |
| K4 | Operator snapshot counts diverge from DB (>5% error) | Stop. Fix snapshot computation. Restart clock. |
| K5 | `pnpm verify` fails during burn-in | Fix. Restart clock. |
| K6 | Ingestor stops ingesting for >24h (both providers) | Stop. Investigate. Cannot run burn-in without live data. |

**Non-kill conditions (log and continue):**
- Single transient delivery failure that retries and recovers
- CLV missing on <20% of picks (data-availability gap, not logic failure)
- Alert agent detects 0 line movements (valid if no qualifying movement occurred)
- Walk-forward backtesting not running (known gap, documented in math proof)

---

## 12. Exit Criteria

Burn-in is complete when **all** of the following are true:

| # | Criterion | Threshold |
|---|-----------|-----------|
| X1 | Duration | ≥3 real slate days, target 7 calendar days |
| X2 | Graded pick volume | ≥20 picks graded |
| X3 | Sport coverage | ≥2 sports with graded picks |
| X4 | Grading accuracy spot-checks | ≥10 spot-checks, 100% correct |
| X5 | CLV populated rate | ≥80% of picks with closing line data |
| X6 | Dead-letter count | 0 for entire burn-in |
| X7 | Duplicate deliveries | 0 for entire burn-in |
| X8 | Operator snapshot reconciliation | ≥3 spot-checks matching DB exactly |
| X9 | Math layer proof bundle complete | All 7 sub-proofs in Section 9 documented (pass or explicit gap) |
| X10 | Edge source distribution recorded | At least 1 day of data showing real-edge vs confidence-delta rates |
| X11 | Evidence bundle complete | All artifacts in Section 6 exist |
| X12 | `pnpm verify` green at exit | Run at exit checkpoint |
| X13 | PM sign-off record exists | Explicit verdict from A Griffin |

---

## 13. Recommendation Template for Post-Burn-In Verdict

Fill this out at exit. This is the PM sign-off record.

```markdown
# Controlled Validation — Post-Burn-In Verdict

**Date:** YYYY-MM-DD
**Burn-in period:** YYYY-MM-DD to YYYY-MM-DD
**Total slate days:** N
**Total picks graded:** N
**Sports covered:** [list]
**Reviewer:** A Griffin

## Gate Status

### Section 7 — Elite Production Gate
[List each 7.x item: PASS / FAIL / GAP / DEFERRED]

### Section 8 Readiness
[List each 8.x item: PROVEN / CONDITIONAL / TEST-ONLY / ABSENT / DEFERRED]

## Math Layer Verdict
[State explicitly for each component: PROVEN / PARTIAL / TEST-ONLY / DEAD-CODE]
[State explicitly whether the Section 8 claim "math is already done" is supported by evidence]

## Incidents During Burn-In
[List all P0/P1/P2 incidents and their resolutions]

## Open Gaps
[List any gaps that do not block Phase 7 but must be tracked as tech debt]

## Blocking Issues for Phase 7
[List any issues that must be resolved before Phase 7 work begins]

## Verdict
[ ] PASS — Phase 7 may begin. No blocking issues.
[ ] CONDITIONAL PASS — Phase 7 may begin with the following constraints: [list]
[ ] FAIL — Phase 7 is blocked until the following are resolved: [list]

## Authorizing signature
A Griffin — [date]
```

---

## Authority and Update Rule

This document is T1. It may only be modified by the PM or with explicit PM approval.

Updates allowed:
- Adding kill condition hits as they occur
- Updating daily checklist log pointers
- Amending exit criteria threshold based on PM decision

Updates not allowed without PM approval:
- Lowering any exit criteria threshold
- Removing any math proof sub-section
- Declaring burn-in complete before all exit criteria are met
