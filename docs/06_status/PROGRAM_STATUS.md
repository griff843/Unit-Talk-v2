# Program Status

> Canonical active status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md` for active maintenance.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> Runtime evidence: `docs/06_status/system_snapshot.md`

## Last Updated

2026-03-23 (Full Lifecycle Truth Verification closed — FULL_LIFECYCLE_VERIFIED)

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | 534/534 passing — deterministic across consecutive runs |
| Gates | All gates PASS. `pnpm verify` exits 0. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) — see `SPRINT_MODEL_v2.md` |

## Gate Notes (2026-03-22)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | Environment files pass validation. |
| `pnpm lint` | PASS | 0 errors. `.next/**` added to eslint ignores. Ported Radix UI components in `apps/smart-form/components/ui/**` exempt from `no-explicit-any` / `no-empty-object-type`. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | 534/534. 6 bounded groups (4–9 files each), chained with `&&`. Deterministic on Windows. |
| `pnpm verify` (full chain) | PASS | Exit 0 on two consecutive runs without memory reset. |

### Runner Architecture (post-hardening)

The root `test` script is split into 6 named groups:

| Script | Files | Surface |
|--------|-------|---------|
| `pnpm test:apps` | 7 | apps/api + apps/worker + apps/operator-web |
| `pnpm test:verification` | 4 | packages/verification |
| `pnpm test:domain-probability` | 6 | domain/probability + domain/outcomes-core |
| `pnpm test:domain-features` | 9 | domain/features + domain/models |
| `pnpm test:domain-signals` | 6 | domain/signals + bands + calibration + scoring |
| `pnpm test:domain-analytics` | 8 | domain/outcomes + market + eval + edge + rollups + system-health + risk + strategy |

`pnpm test` chains all 6 with `&&` (fail-closed). Each group is independently invocable for targeted debugging.

**Previous issue (resolved)**: A single 40-file `tsx --test` invocation caused non-deterministic `STATUS_STACK_BUFFER_OVERRUN` (Windows exit code 3221226505) on the `pnpm verify` chain due to stack exhaustion under memory pressure. Fixed by splitting into groups of ≤9 files — no tsx process now handles more than 9 files. Two consecutive `pnpm verify` runs confirmed deterministic exit 0.

## Live Routing

| Target | Status | Detail |
|--------|--------|--------|
| `discord:canary` | **LIVE** | Permanent control lane. Never removed. |
| `discord:best-bets` | **LIVE** | Real channel `1288613037539852329`. |
| `discord:trader-insights` | **LIVE** | Real channel `1356613995175481405`. |
| `discord:exclusive-insights` | Blocked | Not implemented. |
| `discord:game-threads` | Blocked | Thread routing not implemented. |
| `discord:strategy-room` | Blocked | DM routing not implemented. |

## Sprint Log

| Sprint | Week | Tier | Status | Summary |
|--------|------|------|--------|---------|
| Full Lifecycle Truth Verification | — | T1 | **CLOSED** | All 10 stages verified end-to-end. Fixed: catalog endpoint (DatabaseReferenceDataRepository → InMemoryReferenceDataRepository in database bundle — V2 has no ref-data tables, commit ce7577b). Discord msgId 1485511171011514490 (best-bets). Settlement win, 90.9% ROI. 2 system findings documented: Smart Form V1 missing confidence field (all submissions score 61.5, below 70 threshold) + board caps saturated by test-run picks (perSlate=5). 534/534 tests. Verdict: FULL_LIFECYCLE_VERIFIED. |
| Smart Form Process Hardening | — | T1 | **CLOSED** | Added `scripts/kill-port.mjs` (cross-platform port cleanup) + `predev` hook in `apps/smart-form/package.json`. Zombie process PID 36184 (persistent across all prior proof runs) forcefully killed. `pnpm dev` in Smart Form now always clears port 4100 before starting. HTTP probe confirmed 307 response from fresh process. Verdict: SMART_FORM_PROCESS_HARDENED. 534/534 tests. |
| T1 Recap/Stats Consumer Buildout | — | T1 | **CLOSED** | First application-layer consumer for domain recap stats. `GET /api/operator/recap` live — calls `computeSettlementSummary` from `@unit-talk/domain`. `Settlement Recap` section added to operator dashboard HTML. Verdict: RECAP_STAGE_UNBLOCKED. Stage 9 (Smart Form zombie) still DEVIATION. 534/534 tests. |
| T1 Full-Cycle Proof Rerun | — | T1 | **CLOSED** | Rerun after enqueue gap fix. 7 of 8 wired stages pass. Submit (direct API, SF zombie) → DB (validated→queued at submission) → Distribution (Discord msgId 1485434380414488629) → Operator-web → Settlement (win, 90.9% ROI) → Downstream truth. Stage 9 (recap) still blocked (Blocker B unchanged). Enqueue fix confirmed: `outboxEnqueued:true` in API response, queued lifecycle event at submission time. 531/531 tests. |
| T1 Enqueue Gap Fix | — | T1 | **CLOSED** | Auto-enqueue wired into submitPickController. Qualified picks now transition validated→queued and create outbox row at submission time. 531/531 tests. Live proof: pick a42c6524 outboxEnqueued:true, status=queued, outbox=pending. |
| T1 Full-Cycle Runtime Proof | — | T1 | **CLOSED** | 6 of 7 stages pass. Submit → DB → Distribution (Discord msgId 1485413938513444887) → Operator-web → Settlement (win, 90.9% ROI) → Downstream truth. Stage 7 (recap) blocked (Blocker B). Enqueue gap documented. 528/528 tests. |
| Runner Hardening | — | T1 | **CLOSED** | Split 40-file tsx invocation into 6 bounded groups. pnpm verify now deterministic — exit 0 on two consecutive runs. 528/528 tests. |
| Gate Recovery + Repo Truth (UTV2-32) | — | T1 | **CLOSED** | Restored root pnpm test (supabase-js resolution + stale ref), lint hygiene (.next exclusion + Radix UI exemption), PROGRAM_STATUS.md truth. 528/528 tests. |
| Promotion Scoring Enrichment | 21 | T3 | **CLOSED** | Domain-aware trust/readiness in promotion scoring. 531/531 tests. |
| E2E Platform Validation | 20 | T3 | **CLOSED** | All 9 runtime surfaces validated. Live canary proof. 515/515 tests. |
| Promotion Edge Integration | 19 | T3 | **CLOSED** | Domain analysis edge as Tier 2 fallback in promotion. 515/515 tests. |
| Domain Integration Layer | 18 | T2 | **CLOSED** | Submission-time domain analysis enrichment. 502/502 tests. |
| Git Baseline Ratification | 17 | T2 | **CLOSED** | First commit from audited post-salvage state. 491/491 tests. |
| Settlement Downstream + Domain Salvage | 16 | T1 | **CLOSED** | Runtime integration + Batch 1-5 salvage. 491/491 tests. |
| Probability/Devig Salvage | 15 | T2 | **CLOSED** | Pure math salvage. 128/128 tests. |
| Verification Control Plane Salvage | 14 | T2 | **CLOSED** | Scenario registry, run history, archive. 100/100 tests. |
| Operator Trader-Insights Health | 13 | T2 | **CLOSED** | Operator dashboard health sections. 87/87 tests. |
| Settlement Hardening | 12 | T1 | **CLOSED** | Manual review, correction chains, operator history. 83/83 tests. |
| Trader-Insights Activation | 11 | T1 | **CLOSED** | `discord:trader-insights` live. 72/72 tests. |
| Operator Command Center | 10 | T2 | **CLOSED** | Picks pipeline, channel health, operator snapshot. 62/62 tests. |
| Full Lifecycle Proof | 9 | T1 | **CLOSED** | Submission-to-settled proof. 23 fields verified. |
| Settlement Runtime | 8 | T1 | **CLOSED** | Settlement schema + write path. |
| Best Bets Activation | 7 | T1 | **CLOSED** | `discord:best-bets` live. |
| Runtime Promotion Gate | 6 | T1 | **CLOSED** | Promotion persistence + routing. |

## Next Milestone

**Smart Form V1 — Operator Submission Surface**

The next major work is designing and building the Smart Form V1 operator submission surface. This requires a T1 contract before implementation begins.

## Candidate Work Queue

| Item | Expected Tier | Rationale |
|------|---------------|-----------|
| Smart Form V1 design + contract | T1 | New user-facing surface |
| Offer Fetch service wrapper | T2 | New service, cross-package |
| DeviggingService integration | T2 | Multi-book consensus at submission |
| Risk Engine integration | T2 | Bankroll-aware sizing |
| Observation Hub permanent form | T2 | Architectural promotion |
| Promotion uniqueness/boardFit enrichment | T3 | Pure computation wiring |

## Do Not Start Without Planning

- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- Broad multi-channel expansion beyond Best Bets
- Any new product surface

## Open Risks

| Risk | Severity | Status |
|------|----------|--------|
| Historical pre-fix outbox rows may add noise to operator incident triage | Low | Open |
| Smart Form zombie / stale process on port 4100 | Low | **CLOSED** — `predev` hook kills any process on port 4100 before `next dev` starts. Fix: `scripts/kill-port.mjs` + `predev` in `apps/smart-form/package.json`. |
| API process requires manual restart to load new code — no hot-reload or process manager in dev | Low | Open |
| Recap/performance/accounting surfaces do not yet consume downstream truth | Low | **PARTIALLY RESOLVED** — `GET /api/operator/recap` now calls `computeSettlementSummary` from domain. Full rollups/evaluation/system-health wiring remains deferred. |
| Enqueue gap | Medium | **VERIFIED CLOSED** — fix confirmed in T1 Full-Cycle Proof Rerun (2026-03-23). `outboxEnqueued:true` in API response; queued lifecycle event created at submission time. |
| Smart Form V1 missing `confidence` field — all submissions score 61.5, below promotion threshold 70 | Medium | Open — Smart Form V1 does not include `confidence` in `buildSubmissionPayload()`. Without confidence, domain analysis computes no edge. Promotion score = 61.5 < 70 (best-bets threshold). All Smart Form submissions are not promotion-eligible. Fix: add confidence field to Smart Form or add source-specific promotion scoring. |
| Board caps (perSlate=5) saturated by accumulated test-run picks | Medium | Open — `getPromotionBoardState` counts ALL picks with `promotion_status IN ('qualified', 'promoted')` including settled/historical. After 5+ test runs, both best-bets and trader-insights boards are full. New picks cannot qualify. Fix: filter board state query to only count picks with `lifecycle_state IN ('queued', 'posted')`. |
| Catalog endpoint used DatabaseReferenceDataRepository querying non-existent V2 DB tables | Low | **CLOSED** — Fixed in Full Lifecycle Truth Verification sprint (commit ce7577b). `createDatabaseRepositoryBundle` now uses `InMemoryReferenceDataRepository(V1_REFERENCE_DATA)`. |

## Key Capabilities

- Canonical submission intake live
- Lifecycle transitions enforced (single-writer discipline)
- Promotion persistence + routing gates live (3 channels)
- Settlement write path live (initial + correction chains + manual review)
- Downstream settlement truth computed (effective settlement + loss attribution)
- Operator-web read-only monitoring live
- Discord outbox, worker delivery, receipts, and audit logs live
- Domain analysis enrichment at submission time (implied probability, edge, Kelly)
- Promotion scoring consumes domain analysis for edge, trust, and readiness
- Verification control plane with scenarios, run history, and archive
- Pure computation foundation: probability, devig, calibration, features, models, signals, bands, scoring, outcomes, evaluation, edge-validation, rollups, system-health, risk, strategy

## Authority References

| Purpose | File |
|---------|------|
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Runtime evidence | `docs/06_status/system_snapshot.md` |
| Proof template (T1) | `docs/06_status/PROOF_TEMPLATE.md` |
| Rollback template (T1) | `docs/06_status/ROLLBACK_TEMPLATE.md` |
| Sprint model proposal | `docs/05_operations/SPRINT_MODEL_v2_PROPOSAL.md` |

### Historical References (superseded — not actively maintained)

| File | Status |
|------|--------|
| `docs/06_status/status_source_of_truth.md` | Superseded by this file |
| `docs/06_status/current_phase.md` | Superseded by this file |
| `docs/06_status/next_build_order.md` | Superseded by this file |
| `docs/05_operations/week_*_contract.md` | Historical sprint records |
| `docs/06_status/week_*_proof_template.md` | Historical sprint templates |

## Update Rule

Update this file at every sprint close. For T3 sprints, only the sprint log table needs a new row.
