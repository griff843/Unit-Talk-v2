# Grading + Model Proof Inventory

**Issue:** UTV2-1325  
**Generated:** 2026-06-26  
**Authority:** Code at main HEAD, proof artifacts in `docs/06_status/proof/`, `CURRENT_STATE.md`, `KNOWN_DEBT.md`  
**Scope:** Separate structural proof from winning-pick proof. No certification changes. No DB mutation.

---

## Owner-Facing Verdicts

| Question | Answer |
|---|---|
| **Do we have a working grading system?** | **YES — structurally complete and deployed; evidence settlements proven; public-pick grading unproven post-2026-06-08** |
| **Do we have a working winning model?** | **NO — model structure proven; empirical edge/CLV unproven; two scoring inputs are constant fallbacks** |

---

## 1. Grading System Inventory

### 1.1 Contracts & Types

| Artifact | Location | Status |
|---|---|---|
| `SettlementRequest` with `source: 'grading'` | `packages/contracts/src/settlement.ts` | WORKING |
| `GradeResultRow` / `GradeResultRecord` type alias | `packages/db/src/types.ts` | WORKING |
| `GradeResultRepository` interface | `packages/db/src/repositories.ts:774` | WORKING |
| `GradeResultInsertInput`, `GradeResultLookupCriteria` | `packages/db/src/repositories.ts:759` | WORKING |
| `gradeResults` in `RepositoryBundle` | `packages/db/src/repositories.ts:1065` | WORKING |

### 1.2 Implementations

| Artifact | Location | Status | Notes |
|---|---|---|---|
| `InMemoryGradeResultRepository` | `packages/db/src/runtime-repositories.ts:1228` | WORKING | Used in unit tests + InMemory mode |
| `DatabaseGradeResultRepository` | `packages/db/src/runtime-repositories.ts:4389` | WORKING | Queries `game_results` table via Supabase |
| Bundle wiring — InMemory | `runtime-repositories.ts:8180` | WORKING | `gradeResults: new InMemoryGradeResultRepository()` |
| Bundle wiring — Database | `runtime-repositories.ts:8212` | WORKING | `gradeResults: new DatabaseGradeResultRepository(connection)` |

### 1.3 Service Logic

| Component | File | Tests | Status |
|---|---|---|---|
| `runGradingPass()` | `apps/api/src/grading-service.ts` (1,009 lines) | 58 unit tests | STRUCTURALLY_PROVEN |
| Market family classification (game_total_ou, team_total_ou, player_prop) | grading-service.ts | ✓ | STRUCTURALLY_PROVEN |
| Event/participant resolution | grading-service.ts | ✓ | STRUCTURALLY_PROVEN |
| Outcome mapping (actual_value vs line → win/loss/push) | grading-service.ts | ✓ | STRUCTURALLY_PROVEN |
| Market key aliasing (25+ COMMON_GRADING_MARKET_ALIASES) | grading-service.ts | ✓ | STRUCTURALLY_PROVEN — no live SGO key proof |
| Event provenance validation (SGO provider, ingestion cycle) | grading-service.ts | ✓ | STRUCTURALLY_PROVEN |
| 3-attempt retry (15-min backoff, in-memory) | grading-cron.ts | ✓ | STRUCTURALLY_PROVEN — state lost on crash |
| `recordGradedSettlement()` | `apps/api/src/settlement-service.ts` | 25 tests | STRUCTURALLY_PROVEN |
| `recordEvidenceSettlement()` | settlement-service.ts | T1 proof UTV2-1251 | WORKING — live Supabase proven |
| `startGradingCronLoop()` | `apps/api/src/grading-cron.ts` (270 lines) | 7 tests | STRUCTURALLY_PROVEN |
| Pagination fix (offset-based fetch) | grading-service.ts | T1 proof UTV2-1258 | WORKING — live Supabase proven |

### 1.4 game_results Table

| Item | Status | Notes |
|---|---|---|
| Schema exists (`supabase/migrations/baseline_live_schema.sql`) | WORKING | Table: `id`, `event_id`, `participant_id`, `market_key`, `actual_value`, `source`, `sourced_at` |
| Ingestor writes to it (`apps/ingestor/src/results-resolver.ts:208,245`) | WORKING | SGO feed via `gradeResults.insert()` |
| Grading reads from it (`grading-service.ts:463`) | WORKING | `gradeResults.findResult()` |
| DB constraint: `actual_value` finite check | WORKING | Non-finite guard added by UTV2-1260 (log+skip, not throw) |

### 1.5 Live Proof

| Proof | What It Proves | Status |
|---|---|---|
| UTV2-1251 T1 | Evidence settlement path: awaiting_approval picks settle without lifecycle transition | PASS — live Supabase |
| UTV2-1254 | 143 evidence-plane settlements (90W/53L); 187 standing settlements (97W/78L/12P) | PASS — grading ran, results written |
| UTV2-1257 | Grading-cron wired into production docker-compose + .env.production | MERGED — last confirmed run 2026-06-08 |
| UTV2-1258 T1 | Pagination: `listByLifecycleState` offset honored on live Supabase (previous 1000-row cap fixed) | PASS — live Supabase |
| UTV2-1260 | Non-finite `actual_value` → skip (not error); grading run continues | MERGED |

### 1.6 Grading Gaps

| Gap | Severity | Evidence |
|---|---|---|
| No confirmed grading run since 2026-06-08 | HIGH | UTV2-1257 fix merged but no post-merge runtime proof |
| No end-to-end proof: ingest→game_results→grading→settlement in one monitored run | HIGH | UTV2-1254 proves settlements exist; does not prove live SGO→grade→settle pipeline as unit |
| Market key aliasing not tested against actual SGO API key format | MEDIUM | Unit tests use mocks; no live SGO grading event logged |
| In-memory retry state lost on process crash | LOW | By design; follow-up lane required for persistent retry |
| Public (posted) picks: 0 graded settlements post-Phase-7A governance brake | HIGH — expected | Governance brake holds picks in `awaiting_approval`; public settlement requires PM gate |

### 1.7 Grading Classification Summary

| Component | Classification | Blocker |
|---|---|---|
| Grading contracts + types | WORKING | — |
| GradeResultRepository (both implementations) | WORKING | — |
| Service logic (runGradingPass) | STRUCTURALLY_PROVEN | No live game_results→grading proof since 2026-06-08 |
| Evidence settlement path | WORKING | — (143 proven) |
| Public pick grading path | UNPROVEN | Governance brake; no posted picks have been graded since Phase 7A |
| End-to-end ingest→grade→settle pipeline | PARTIALLY_PROVEN | Pieces proven separately; no single monitored run proof |
| CLV from grading event | PARTIALLY_PROVEN | Structure wired (UTV2-1262); 0 forward-flow CLV settlements post-deploy |

---

## 2. Model / Scoring System Inventory

### 2.1 computeStatProjection & Feature Modules

| Component | File | Tests | Status |
|---|---|---|---|
| `computeStatProjection()` — core projection pipeline | `packages/domain/src/models/stat-distribution.ts` | Determinism tests (UTV2-1218) | STRUCTURALLY_PROVEN |
| matchup-context feature | `packages/domain/src/features/matchup-context.ts` (UTV2-1211) | ✓ | STRUCTURALLY_PROVEN |
| player-form feature | `packages/domain/src/features/player-form.ts` (UTV2-1212) | ✓ | STRUCTURALLY_PROVEN |
| opportunity feature | `packages/domain/src/features/opportunity.ts` (UTV2-1213) | ✓ | STRUCTURALLY_PROVEN |
| efficiency feature | `packages/domain/src/features/efficiency.ts` (UTV2-1214) | ✓ | STRUCTURALLY_PROVEN |
| game-context feature | `packages/domain/src/features/game-context.ts` (UTV2-1215) | ✓ | STRUCTURALLY_PROVEN |
| NaN / Infinity guard (UTV2-1225) | stat-distribution.ts + features | ✓ | WORKING |
| Determinism proof | UTV2-1218 evidence bundle | PASS | STRUCTURALLY_PROVEN — synthetic corpus only |
| Fault injection (74 tests, UTV2-1219) | — | 74 PASS | STRUCTURALLY_PROVEN |
| D-CONST-5 resolution (UTV2-1220) | — | Structural | STRUCTURALLY_PROVEN — empirical deferred |

**Wave 5 note:** All five feature modules merged and unit-tested. No live-data proof exists that the feature modules produce meaningful projections for real SGO player props.

### 2.2 5-Score Promotion Pipeline

| Score | Weight | Implementation | Status | Live Proof |
|---|---|---|---|---|
| **edge** | ~35% | `apps/api/src/real-edge-service.ts:computeRealEdge()` | WORKING | Yes — provenance tracked (UTV2-985) |
| **trust** | variable | `apps/api/src/clv-feedback.ts:computeClvTrustAdjustment()` | STRUCTURALLY_PROVEN | Insufficient CLV corpus (< 10 samples per capper) |
| **readiness** | ~20% | `packages/domain/src/promotion.ts` via kellySizing | **DEBT-020: BROKEN INPUT** | 94.4% picks → constant fallback 60 |
| **uniqueness** | variable | Correlation penalty + board scarcity | STRUCTURALLY_PROVEN | Logic proven; no live saturation proof |
| **boardFit** | variable | Per-slate/sport/game caps | WORKING | Live board caps enforced |
| 5-score promotion evaluation | — | `apps/api/src/promotion-service.ts:evaluateAllPoliciesEagerAndPersist()` | WORKING | Live promotion decisions logged |

### 2.3 Critical Scoring Debt (DEBT-019 + DEBT-020)

**These two debts directly block winning-model proof:**

| Debt ID | Area | What's Broken | Impact |
|---|---|---|---|
| **DEBT-019** | `domainAnalysis` not populated | `readDomainAnalysisEdgeScore()` falls back to `confidenceScore` for 92.4% of picks | Edge (35% of promotion score) is effectively the submitter's stated confidence — not a model signal |
| **DEBT-020** | `kellySizing` not populated | `readKellyGradientReadiness()` returns constant 60 for 94.4% of picks | Readiness (20% of promotion score) is a constant — not a live sizing signal |
| **DEBT-018** | `band` not persisted on pick | CLV/ROI sliced by band is impossible | Edge ratification (UTV2-896) blocked; only unsliced aggregate available |

**Net effect:** 35% + 20% = **55% of the weighted promotion score is constant fallback, not a model signal.** The system produces and gates picks, but the dominant scoring inputs for those decisions are not grounded in model computation.

### 2.4 CLV Computation

| Component | Status | Evidence |
|---|---|---|
| CLV schema (picks → pick_candidates → market_universe → closing_over_odds) | WORKING | UTV2-1042 gate: 2,607 closing_over_odds rows; 126 CLV-join picks |
| CLV computation logic | PARTIALLY_PROVEN | UTV2-750, 754 T1 tests pass; computation produces values on historical corpus |
| CLV forward-flow write path (UTV2-1262, deployed ~2026-06-12) | UNPROVEN | 0 qualifying evidence-eligible settlements post-deploy |
| CLV trust feedback (30-day lookback) | UNPROVEN | Insufficient corpus; min 10 samples per capper required; not met |
| `missing_event_context` (1,913 orphan picks) | WORKING (correct) | 99.7% are `band=SUPPRESS` — correct fail-closed; NOT a resolver defect |
| CLV settlement payload | PARTIALLY_PROVEN | 45 historical CLVs from pre-deploy corpus (UTV2-736); forward flow unexercised |

### 2.5 Real Edge Computation

| Component | Status | Evidence |
|---|---|---|
| `computeRealEdge()` — Pinnacle→consensus→SGO→single-book fallback chain | WORKING | UTV2-985 T1: provenance tracked, method logged |
| Devig methods (proportional, shin, power, logit) | STRUCTURALLY_PROVEN | Unit tests cover all methods |
| Edge provenance stored on pick metadata | WORKING | Live picks have `EdgeProvenance` |
| Edge as market-vs-model signal | **DEBT-019 BLOCKED** | Without domainAnalysis, model_probability = stated confidence |

### 2.6 P3/P4 Certification State

| Program | State | Gate |
|---|---|---|
| **P3 — Decision Integrity Convergence** | ACTIVE_NOT_CERTIFIED | Empirical CLV/edge evidence required; UTV2-1042 gates MET (126 CLV-join picks); PM verdict NOT rendered; snapshot stale since 2026-06-10 |
| **P4 — Execution & Economic Truth** | CONDITIONAL_NOT_CERTIFIED | Execution proven (settlement immutable, dual-auth); economic truth (ROI, CLV attribution, profit) requires realized settled corpus with CLV |
| **P5 — Institutional Runtime** | FROZEN | Requires P1–P4 certified + burn-in PASS + M10 Path A |

**Forbidden claims (HARD CONSTRAINTS — unchanged):**
- Proven edge, ROI, or CLV — FORBIDDEN (P3/P4 not certified)
- P3 certification — FORBIDDEN (empirical gate verdict not rendered)
- P5 unfreeze — FROZEN

### 2.7 Model Proof Matrix

| Component | Classification | Proof Artifact | What Is Proven | What Is NOT Proven |
|---|---|---|---|---|
| computeStatProjection | STRUCTURALLY_PROVEN | UTV2-1218 determinism; UTV2-1219 fault injection | Deterministic output; NaN guards; distribution fitting | Live SGO data produces correct projections; feature weights calibrated to real outcomes |
| 5 feature modules (Wave 5) | STRUCTURALLY_PROVEN | UTV2-1211–1215 merges; unit tests | Code correct; extracts signals from mock inputs | Signal quality on live player data; no regression vs baseline model |
| Real edge computation | WORKING | UTV2-985 T1; EdgeProvenance on picks | Market data sourcing; devig math; provenance captured | DEBT-019: model_probability = confidence proxy, not true model edge |
| 5-score promotion (3 of 5 inputs live) | PARTIALLY_PROVEN | UTV2-674 proof; live promotion decisions | Promotion fires; gate checks enforced; audit trail complete | Edge (confidence proxy) + Readiness (constant) dominate; not a model-grounded decision |
| CLV path (schema + query) | PARTIALLY_PROVEN | UTV2-1042 data gate; UTV2-750, 754 T1 | Schema valid; CLV join works; 126 picks available | 0 forward-flow CLV settlements post-deploy |
| CLV forward-flow write | UNPROVEN | UTV2-1262 merged | Code deployed | No qualifying post-deploy settlement has produced a CLV record |
| CLV trust feedback | UNPROVEN | Code exists | Algorithm correct in unit tests | Corpus too small; never produced live trust adjustment |
| Winning model (profit/edge) | UNPROVEN | None | — | P3 not certified; domainAnalysis missing; CLV unexercised; no ROI/profit data |

---

## 3. What Is Proven vs Not Proven — Summary

### Proven (evidence exists, no gaps)
- Grading system structure: contracts, implementations, service logic, cron
- Evidence-plane settlement (143 written, 90W/53L)
- Pagination fix (grading can fetch all eligible picks)
- CLV schema and join path (126 picks available)
- Promotion pipeline firing (decisions logged, gates enforced)
- Real edge market data sourcing and provenance capture
- Settlement immutability (DB trigger; correction chain)

### Structurally Proven (tests pass, no live-data proof)
- computeStatProjection determinism and fault handling
- 5 feature modules (Wave 5)
- Market key aliasing in grading
- Event provenance validation
- 3-attempt retry logic

### Partially Proven (structure works, endpoint unexercised)
- CLV computation on live Supabase (historical corpus; 0 post-deploy CLV settlements)
- End-to-end grading pipeline (pieces proven separately; no monitored ingest→grade→settle run since 2026-06-08)
- 5-score promotion (3 of 5 scoring inputs live; 2 are constant fallbacks)

### Unproven (no evidence)
- Forward-flow CLV write path (0 qualifying settlements since 2026-06-12 deploy)
- CLV trust feedback producing a live trust adjustment
- Model edge: computeStatProjection output improving promotion decisions over confidence baseline
- Winning picks: profitable outcomes attributable to the model
- grading-cron running in production since UTV2-1257 (2026-06-08) — no confirmed run

### Broken or Missing (structural gap)
- DEBT-019: `domainAnalysis` unpopulated → 92.4% of edge score = submitter confidence
- DEBT-020: `kellySizing` unpopulated → 94.4% of readiness score = constant 60
- DEBT-018: `band` not persisted → CLV/ROI band-slicing impossible

---

## 4. Next Lanes (Blocker Sequence)

| Priority | Lane | Unlocks |
|---|---|---|
| 1 | **UTV2-1324** (Winning Picks Pipeline Truth Audit) | Evidence table for winning-pick proof; sample size verdict |
| 2 | **UTV2-1322** (Production DB truth audit) | Confirms game_results freshness; grading pipeline health |
| 3 | Refresh UTV2-1042 data-gate snapshot | Enables PM to render P3 cert verdict (PASS/FAIL/DEFER — any outcome) |
| 4 | DEBT-019 fix lane | Populates `domainAnalysis` → restores edge as market signal (not confidence proxy) |
| 5 | DEBT-020 fix lane | Populates `kellySizing` → restores readiness as sizing signal (not constant 60) |
| 6 | Post-UTV2-1257 grading runtime proof | Confirms grading cron is running in production post-fix |

---

*Authority: Code read at main HEAD `4cf30f5e`, proof artifacts under `docs/06_status/proof/`, `CURRENT_STATE.md` verified 2026-06-25.*
