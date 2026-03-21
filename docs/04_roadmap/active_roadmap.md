# Active Roadmap

This is the active sequencing document for `unit-talk-v2`.

Use this file to answer:
- what is already complete
- what is currently in progress
- what must happen next
- what is blocked from widening scope

If Linear, Notion, or chat history disagree with this file, update them to match this file or explicitly record the divergence.

## Current Position

- Week 1: complete
- Week 2: complete
- Week 3: complete
- Week 4: complete
- Week 5: complete
- Week 6: complete
- Week 7: complete
- Week 8: complete
- Week 9: complete
- Week 10: complete
- Week 11: complete - `discord:trader-insights` live, closed 2026-03-21
- Week 12: complete - settlement hardening, 83/83 tests, closed 2026-03-21
- Week 13: complete - operator trader-insights health, 87/87 tests, closed 2026-03-21
- Week 14: complete - verification control plane salvage, 100/100 tests, closed 2026-03-21
- Week 15: complete - probability and devig math salvage, 128/128 tests, closed 2026-03-21
- Week 16: complete - settlement downstream and loss attribution plus accepted Batch 1 through Batch 5 salvage foundation, 491/491 tests, independent verification PASS, closed 2026-03-21
- Week 17: complete - Git baseline ratification, first commit, .gitignore hardened, status docs reconciled, closed 2026-03-21
- Week 18: complete - Domain integration layer, submission-time domain analysis enrichment using devig + kelly-sizer, 502/502 tests, closed 2026-03-21

Week 16 currently includes:
- runtime integration complete on the canonical settlement path and operator-web picks pipeline
- accepted Batch 1 foundation under `market`, `features`, `models`, and `signals`
- accepted Batch 2 foundation under `bands`, `calibration`, and `scoring`
- accepted Batch 3 foundation under `outcomes`, `evaluation`, `edge-validation`, plus `market-reaction`
- accepted Batch 4 foundation under `rollups`, `system-health`, and `baseline-roi`
- accepted Batch 5 foundation under `risk` and `strategy`
- `strategy` remains intentionally commented out from the top-level domain index until the `americanToDecimal` naming collision is resolved cleanly

## Completed Sequence

### Weeks 1-5

Completed outcomes:
- monorepo bootstrap and shared package structure
- CI, lint, type-check, build, and env validation
- core architecture contracts
- Notion and Linear seed surfaces
- live Supabase setup and generated types
- submission intake, canonical pick creation, lifecycle transitions, outbox enqueueing, receipts, audits, and run tracking
- live Discord canary delivery, embed formatting, and operator visibility
- smart-form UX and operator operational refinement
- governance closeout and Best Bets GO decision

### Week 6 - Best Bets Promotion

Completed outcomes:
- promotion fields live in schema
- `pick_promotion_history` table live
- runtime promotion evaluation wired into submission/distribution path
- non-qualified picks blocked from `discord:best-bets`
- operator overrides persisted and auditable
- promotion runtime tests and CI enforcement in place

### Week 7 - Best Bets Controlled Live Activation

Completed outcomes:
- `discord:best-bets` switched to the real channel
- first real-channel qualified post sent through the normal worker path
- proof bundle captured in `docs/06_status/system_snapshot.md`
- monitoring window passed without rollback
- `discord:canary` remained active and healthy

### Week 8 - Settlement Implementation

Completed outcomes:
- `settlement_records` schema migration applied and generated types updated
- canonical settlement write path implemented
- additive correction and manual-review path live
- operator settlement visibility live
- first posted-to-settled proof captured and independently verified

### Week 9 - Full Lifecycle Proof And Anti-Drift Cleanup

Completed outcomes:
- one complete lifecycle independently verified end to end
- all 23 proof fields independently verified
- three audit entries confirmed
- anti-drift cleanup completed
- readiness decision written

### Week 10 - Operator Command Center Normalization

Completed outcomes:
- `OperatorSnapshot` extended with `bestBets` and `picksPipeline`
- `discord:best-bets` health section live in operator-web
- `GET /api/operator/picks-pipeline` endpoint live
- picks pipeline HTML section live
- trader insights graduation criteria ratified
- independent verification passed

### Week 11 - Trader Insights Activation

Completed outcomes:
- target and policy framework generalized
- `discord:trader-insights` activated in the real channel
- canary preview, real-channel post, and independent verification all passed

### Week 12 - Settlement Hardening

Completed outcomes:
- manual review two-phase resolution
- multi-hop correction chains
- operator settlement history and labels
- feed settlement explicitly blocked
- independent verification passed

### Week 13 - Operator Trader Insights Health

Completed outcomes:
- trader insights health summary added to `OperatorSnapshot`
- trader insights health card added to operator-web
- live snapshot verified 10/10 checks PASS

### Week 14 - Verification Control Plane Salvage

Completed outcomes:
- `packages/verification` added with scenarios, run-history, and archive modules
- V2-native scenarios and replay packs added
- CLI query surface added
- independent verification passed

### Week 15 - Probability And Devig Math Salvage

Completed outcomes:
- `packages/domain/src/probability/` added with devig, probability layer, and calibration
- 28 new tests added
- math equivalence confirmed against legacy source
- code audit clean and independent verification passed

### Week 16 - Settlement Downstream Truth And Full Pure-Domain Salvage Foundation

Completed outcomes:
- downstream settlement truth and loss attribution foundation added under `packages/domain/src/outcomes`
- downstream truth wired into `apps/api/src/settlement-service.ts`
- canonical settlement API returns downstream bundle
- operator-web picks pipeline uses effective corrected settlement
- Batch 1 through Batch 5 pure-computation salvage accepted into `@unit-talk/domain`
- cumulative gates now pass at `491/491` tests, lint clean, type-check clean, and build clean

## Hard Rules

- `discord:canary` is permanent. Never remove it from live routing.
- `discord:best-bets` is live and stable. Do not change its target map without a defined plan.
- `discord:game-threads` and `discord:strategy-room` remain blocked for live routing.
- Do not open new product surfaces before the docs named in `docs/05_operations/delivery_operating_model.md` are updated.
- Do not treat chat history as the system of record.
- Program kill conditions are defined in `docs/06_status/status_source_of_truth.md`.
- Doc authority tiers and conflict resolution rules are in `docs/05_operations/docs_authority_map.md`.
- `C:\dev\unit-talk-production` is a bounded reference source only; see `docs/05_operations/legacy_repo_reference_boundary.md` and `docs/05_operations/migration_ledger.md`.

### Week 17 - Git Baseline Ratification

Completed outcomes:
- First Git commit created from audited post-salvage repo state
- `.gitignore` hardened to exclude proof artifacts and operational noise
- Status docs reconciled to reflect implemented reality
- All verification gates passing at time of commit

### Week 18 - Domain Integration Layer

Completed outcomes:
- `apps/api/src/domain-analysis-service.ts` created: computes implied probability, edge, and Kelly sizing at submission time
- Uses `americanToImplied` from `@unit-talk/domain` (probability/devig) and `americanToDecimal`/`computeKellyFraction` from `@unit-talk/domain` (risk/kelly-sizer)
- `apps/api/src/submission-service.ts` modified: enriches `pick.metadata.domainAnalysis` before persistence
- Fail-open: picks without odds are not enriched
- 11 new tests added
- Cumulative gates pass at 502/502 tests

## Next Required Moves

1. Sync Notion Week 16 + 17 + 18 checkpoints to match repo truth.
2. Sync Linear Week 16 + 17 + 18 issues to Done.
3. Define and ratify a Week 19 contract before beginning new implementation work.
4. Do not widen scope without a ratified contract.

## Required Sync Targets

Whenever this roadmap changes, update:
- `docs/06_status/status_source_of_truth.md`
- `docs/06_status/current_phase.md`
- Notion weekly status and checkpoint pages
- Linear milestone and issue state
