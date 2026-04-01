# Package: @unit-talk/domain

Pure business logic and computation. Scoring, probability, devigging, promotion evaluation, outcome resolution, bands, risk sizing, signals, and feature extraction — all stateless, no I/O.

## Role in Unit Talk V2

- System layer: **domain / pure computation**
- Pure: yes (no DB, no HTTP, no side effects, no `process.env`)
- Maturity: rich (37 test files, 24+ modules)

## Role in Dependency Graph

**Imports:** `@unit-talk/contracts` only

**Depended on by:** `@unit-talk/db`, `apps/api`, `apps/worker`, `apps/operator-web`

## What Lives Here

**Core modules (re-exported from index.ts):**
- `submission.ts` — `createValidatedSubmission()`
- `picks.ts` — `createCanonicalPickFromSubmission()`
- `distribution.ts` — `buildDistributionWorkItem()`
- `promotion.ts` — `evaluatePromotionEligibility()`, `evaluateBestBetsPromotion()`, `replayPromotion()`, `calculateScore()`
- `market-key.ts` — `normalizeMarketKey()` with canonical key map
- `correlation-detection.ts` — `detectCorrelatedPicks()`, `computeCorrelationPenalty()`
- `member-lifecycle.ts` — tier state machine, `evaluateTierTransition()`, `hasAccess()`
- `hedge-detection.ts` — `detectHedgeOpportunities()`, arbitrage/middle/hedge classification
- `multi-book-consensus.ts` — `computeMultiBookConsensus()`, median-based odds aggregation
- `clv-weight-tuner.ts` — `analyzeWeightEffectiveness()`, Pearson correlation per component
- `execution-quality.ts` — delivery latency and line freshness metrics
- `shadow-mode.ts` — `parseShadowModeEnv()`, `isShadowEnabled()`

**Sub-modules (directory-based):**
- `probability/` — `proportionalDevig()`, `computeConsensus()`, `computeProbabilityLayer()`, calibration metrics
- `outcomes/` — `resolveOutcome()`, `classifyLoss()`, `computeFlatBetROI()`, performance reports
- `bands/` — band assignment (A+/A/B/C/SUPPRESS), edge/uncertainty thresholds, downgrade logic
- `scoring/` — sport-specific weight configs (NBA, NFL, MLB, NHL), weight validation
- `features/` — player form extraction, game context, opportunity, efficiency
- `models/` — model blend (60% market + 30% sharp + 10% signal), CLV forecast, stat distributions
- `signals/` — market signals, book dispersion, signal quality
- `risk/` — Kelly criterion sizing (`computeKellySize()`, `DEFAULT_BANKROLL_CONFIG`)
- `edge-validation/` — edge calibrator, CLV analyzer, edge validator
- `rollups/` — daily rollup, drift detector
- `system-health/` — health report generation, monitoring types

**Excluded from barrel (name collisions, use direct import):**
- `strategy/` — execution simulator, bankroll simulator, strategy evaluation
- `calibration/` — calibration engine, analysis
- `evaluation/` — alpha evaluation, band evaluation, regime stability

## Core Concepts

**Probability pipeline:** odds → devig (proportional/shin/power/logit) → consensus (multi-book weighted) → uncertainty → dynamic cap → pFinal

**Promotion scoring:** 5-input weighted sum (edge, trust, readiness, uniqueness, boardFit) evaluated against per-policy thresholds. 15 gate checks in order. Deterministic replay via snapshots.

**Band system:** picks classified into A+/A/B/C/SUPPRESS tiers based on edge, uncertainty, CLV, liquidity. Downgrade and suppression rules enforced.

**Kelly sizing:** fractional Kelly with configurable bankroll, multiplier, max fraction, daily loss limit.

## Runtime Behavior

None. All functions are stateless and deterministic. No database access, no HTTP calls, no environment variable reads.

## Tests

37 test files co-located with source. Coverage spans: probability (devig, calibration, probability-layer), outcomes (resolver, loss attribution, settlement downstream), bands, scoring weights, features (player form, game context, opportunity, efficiency), models (blend, CLV forecast, sharp consensus, stat distribution), signals, risk, hedge detection, correlation detection, market key normalization, member lifecycle, execution quality, shadow mode, strategy, system health, rollups, evaluation, edge validation.

## Rules

- Keep pure — no imports from `@unit-talk/db`, no HTTP, no `process.env`
- Scoring logic belongs here, not in API services
- All computation must be deterministic and replayable from inputs
- Use `@unit-talk/contracts` types as input/output — do not redefine them
- Threshold constants must carry version strings

## What NOT to Do

- Do not add database access or repository calls
- Do not read environment variables (config belongs in apps or `@unit-talk/config`)
- Do not add side effects (logging, metrics, HTTP calls)
- Do not duplicate types from contracts
- Do not add app-specific orchestration logic (that belongs in API/worker services)

## Known Drift or Cautions

- `americanToDecimal` exists in both `risk/kelly-sizer.ts` and `probability/devig.ts` — name collision is why `risk/` and `strategy/` are excluded from the barrel export
- `computeBrierScore`/`computeLogLoss` also collide between `probability/calibration` and `evaluation/` — use direct imports
- Uniqueness score input is hardcoded to 50 in the API service, not here — domain has no signal wired for it yet


---

## System Invariants (inherited from root CLAUDE.md)

**Test runner:** `node:test` + `tsx --test` + `node:assert/strict`. NOT Jest. NOT Vitest. NOT `describe/it/expect` from Jest. Assertion style: `assert.equal()`, `assert.deepEqual()`, `assert.ok()`, `assert.throws()`.

**Module system:** ESM (`"type": "module"`) — use `import`/`export`, not `require`/`module.exports`. File extensions in imports use `.js` (TypeScript resolution).

**Schema invariants (never get these wrong):**
- `picks.status` = lifecycle column (NOT `lifecycle_state`)
- `pick_lifecycle` = events table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (NOT pick id)
- `audit_log.entity_ref` = pick id as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = correction FK; original row is never mutated

**Data sources:** SGO API (`SGO_API_KEY`) and The Odds API (`ODDS_API_KEY`) via `apps/ingestor`. Both OpenAI and Anthropic Claude are in use in `packages/intelligence` and `apps/alert-agent`.

**Legacy boundary:** `C:\dev\unit-talk-production` is reference-only. No implicit truth import from legacy behavior. Any reused behavior must have a v2 artifact or runtime proof.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. Use `pnpm test` for unit tests, `pnpm test:db` for live DB smoke tests.
