# Program Status

> Canonical active status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md` for active maintenance.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> Issue queue: `docs/06_status/ISSUE_QUEUE.md`

## Last Updated

2026-03-27 — UTV2-44 CLOSED (PR #21 merged). 617/617 tests on main. M7 one lane remaining (UTV2-46).

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests (main, verified 2026-03-27) | **617/617 passing** — 0 failures, all 6 groups clean |
| Gates | All gates PASS on current main. `pnpm verify` exits 0. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) per `SPRINT_MODEL_v2.md` |
| Active lanes | UTV2-46 READY (CLV wiring — sole remaining M7 lane) |
| Milestone | M7 — Discord social surfaces + CLV wiring (1/2 lanes closed) |

## Gate Notes (2026-03-27)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors. `.next/**` in eslint ignores. Radix UI components exempt from `no-explicit-any`/`no-empty-object-type`. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | **617/617**. 6 bounded groups chained with `&&`. Verified 2026-03-27 after UTV2-44 merge. |
| `pnpm verify` (full chain) | PASS | Exit 0. |

### Runner Architecture

Root `test` script: 6 named groups, each ≤10 files, chained `&&` (fail-closed).

| Script | Files | Surface |
|--------|-------|---------|
| `pnpm test:apps` | 10 | api (6 files) + worker + operator-web + discord-bot |
| `pnpm test:verification` | 4 | packages/verification |
| `pnpm test:domain-probability` | 6 | domain/probability + domain/outcomes-core |
| `pnpm test:domain-features` | 9 | domain/features + domain/models |
| `pnpm test:domain-signals` | 6 | domain/signals + bands + calibration + scoring |
| `pnpm test:domain-analytics` | 9 | domain/outcomes + market + eval + edge + rollups + system-health + risk + strategy + market-key |

**Note:** `apps/smart-form` tests run via `pnpm --filter @unit-talk/smart-form test` only — not in root `pnpm test`. 12/12 smart-form tests pass locally.

---

## Live Routing

| Target | Status | Detail |
|--------|--------|--------|
| `discord:canary` | **LIVE** | Permanent control lane. Never removed. |
| `discord:best-bets` | **LIVE** | Real channel `1288613037539852329`. |
| `discord:trader-insights` | **LIVE** | Real channel `1356613995175481405`. |
| `discord:exclusive-insights` | Blocked | Not implemented. |
| `discord:game-threads` | Blocked | Thread routing not implemented. |
| `discord:strategy-room` | Blocked | DM routing not implemented. |

---

## Active Lanes (as of 2026-03-27)

| ID | Item | Tier | Status | Notes |
|----|------|------|--------|-------|
| UTV2-44 | Discord /leaderboard + GET /api/operator/leaderboard | T2 | **CLOSED** | PR #21 merged. 617/617. |
| UTV2-46 | CLV settlement wiring (computeAndAttachCLV) | T2 | **READY** | Contract: `T2_CLV_SETTLEMENT_WIRING_CONTRACT.md`. Sole remaining M7 lane. |

---

## Sprint Log

> New entries prepended. Historical rows preserved.

| Sprint | Issue | Tier | Status | Summary |
|--------|-------|------|--------|---------|
| Discord /leaderboard Command | UTV2-44 | T2 | **CLOSED** 2026-03-27 | `GET /api/operator/leaderboard` ranked response; Discord `/leaderboard` public embed (responseVisibility:'public' + fail-closed router); 617/617 tests (+11 net-new). PR #21 merged. |
| Smart Form Participant Autocomplete | UTV2-45 | T3 | **CLOSED** 2026-03-27 | `ParticipantAutocompleteField` debounced typeahead in BetForm; helpers in `lib/participant-search.ts` (pure, testable); 12/12 smart-form tests. PR #20 merged. |
| Operator Entity Ingest Health | UTV2-42 | T2 | **CLOSED** 2026-03-27 | `entityHealth` in operator snapshot; `/api/operator/participants` endpoint; HTML dashboard sections (Upcoming Events, Entity Catalog, Last Ingest Cycle). Live proof: 46 events, 535 players, 124 teams. PR #19 merged. |
| Smart Form Conviction Field | UTV2-40 | T1 | **CLOSED** 2026-03-27 | conviction=1–10 → trust 10–100 in `metadata.promotionScores`. Live proof: 4 picks verified. PR #17 merged. |
| Market Key Normalization | UTV2-33 | T2 | **CLOSED** 2026-03-27 | `normalizeMarketKey()` at submission time; market stored as canonical key (e.g., `points-all-game-ou`). Live proof: 3 picks verified. PR #18 merged. 598 tests at merge. |
| Board Cap Lifecycle Filter | UTV2-38 | T3 | **CLOSED** 2026-03-27 | `getPromotionBoardState` now filters to queued/posted only; saturated-board bug from test-run picks resolved. PR #12 merged. |
| Queue Tooling | UTV2-36 | T3 | **CLOSED** 2026-03-27 | `scripts/claim-issue.mjs` + `scripts/submit-issue.mjs` claim/submit lane scripts. PR #9 merged. |
| SGO Results Seed Proof | UTV2-37 | T3 | **CLOSED** 2026-03-27 | `scripts/seed-game-result.ts` proof seeder; 1 live grading proof produced. PR #11 merged. |
| Discord /stats Command | UTV2-31 | T2 | **CLOSED** 2026-03-27 | `GET /api/operator/stats` + Discord `/stats @capper` command; capper win rate, ROI, CLV (null until UTV2-46 lands). PR #13 merged. 591 tests at merge. |
| Discord Bot Deploy Commands Verify | UTV2-34 | T3 | **CLOSED** 2026-03-27 | `deploy-commands` script live; reaches Discord API. **KNOWN GAP**: `DiscordAPIError[20012]` — DISCORD_CLIENT_ID in `local.env` (`1045344984280346674`) does not match the application owning the bot token. Script correct; fix requires verifying CLIENT_ID in Discord Developer Portal. PR #8 merged. |
| SGO Results Ingest | UTV2-30 | T2 | **CLOSED** 2026-03-26 | `apps/ingestor/` live; populates `provider_offers` and `game_results` from SGO feed. PR #3 merged. |
| T1 Automated Grading | UTV2-28 | T1 | **CLOSED** 2026-03-26 | `POST /api/grading/run` live; grading-service evaluates picks against game_results; `recordGradedSettlement()` writes settlement records. Live proof: `attempted=4, graded=1, skipped=3, errors=0`. Settlement `1c9d8581`. Idempotent. |
| Deploy Commands Verify | UTV2-34 | T3 | **CLOSED** 2026-03-26 | (see above) |
| — | — | — | — | **— entries above this line added 2026-03-27; entries below from prior log —** |
| UTV2-34 Deploy Commands Verify | — | T3 | **IN_REVIEW** *(stale — now CLOSED above)* | *(historical — see CLOSED row above)* |
| Full Lifecycle Truth Verification | — | T1 | **CLOSED** | All 10 stages verified. Discord msgId 1485511171011514490. Settlement win, 90.9% ROI. 534/534 tests. Verdict: FULL_LIFECYCLE_VERIFIED. |
| Smart Form Process Hardening | — | T1 | **CLOSED** | `scripts/kill-port.mjs` + `predev` hook. 534/534 tests. |
| T1 Recap/Stats Consumer Buildout | — | T1 | **CLOSED** | `GET /api/operator/recap` live. 534/534 tests. |
| T1 Full-Cycle Proof Rerun | — | T1 | **CLOSED** | 531/531 tests. Enqueue fix confirmed. |
| T1 Enqueue Gap Fix | — | T1 | **CLOSED** | 531/531 tests. `outboxEnqueued:true` in API response. |
| T1 Full-Cycle Runtime Proof | — | T1 | **CLOSED** | 528/528 tests. |
| Runner Hardening | — | T1 | **CLOSED** | Split 40-file tsx into 6 bounded groups. 528/528 tests. |
| Gate Recovery + Repo Truth | — | T1 | **CLOSED** | 528/528 tests. |
| Promotion Scoring Enrichment | 21 | T3 | **CLOSED** | Domain-aware trust/readiness. 531/531 tests. |
| E2E Platform Validation | 20 | T3 | **CLOSED** | All 9 surfaces validated. 515/515 tests. |
| Promotion Edge Integration | 19 | T3 | **CLOSED** | Domain analysis edge in promotion. 515/515 tests. |
| Domain Integration Layer | 18 | T2 | **CLOSED** | Submission-time domain analysis. 502/502 tests. |
| Git Baseline Ratification | 17 | T2 | **CLOSED** | First commit. 491/491 tests. |
| Settlement Downstream + Domain Salvage | 16 | T1 | **CLOSED** | Runtime integration + Batch 1-5. 491/491 tests. |
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

---

## Next Milestone (M8 — not yet planned)

M7 closes when UTV2-44 and UTV2-46 both merge. M8 has no ratified contract yet.

**Candidate items for M8:**

| Item | Expected Tier | Rationale |
|------|---------------|-----------|
| CLV wiring live proof (after UTV2-46) | T1 verify | Confirm `/stats` and `/leaderboard` avgClvPct non-null in live DB |
| Discord CLIENT_ID fix | T3 | `DiscordAPIError[20012]` — CLIENT_ID in `local.env` doesn't match bot token owner; blocks `deploy-commands` from deploying to real guild |
| Smart Form `confidence` field | T2 | Without it, all Smart Form submissions score 61.5, below best-bets threshold (70); currently ineligible for promotion |
| Offer Fetch service wrapper | T2 | Multi-book consensus at submission |
| DeviggingService integration | T2 | Service wrapper around existing pure-computation devig |
| Risk Engine integration | T2 | Bankroll-aware sizing service wrapper |
| Discord `/recap` command | T2 | RecapAgent not implemented; deferred |

**Do not open without a ratified M8 contract.**

---

## Do Not Start Without Planning

- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- Broad multi-channel expansion
- Any new product surface without a ratified contract

---

## Open Risks

| Risk | Severity | Status |
|------|----------|--------|
| Discord CLIENT_ID mismatch — `deploy-commands` fails with `DiscordAPIError[20012]` | Medium | **Open** — CLIENT_ID `1045344984280346674` in `local.env` does not match the application owning the bot token. Fix: verify correct APPLICATION_ID in Discord Developer Portal. Script is correct; credentials are wrong. |
| Smart Form `confidence` field missing — all submissions score 61.5 | Medium | **Open** — `buildSubmissionPayload()` does not include `confidence`. Domain analysis computes no edge. All Smart Form picks ineligible for best-bets (threshold 70). |
| Board caps (perSlate=5) may re-saturate | Low | **PARTIALLY RESOLVED** — lifecycle filter fix (UTV2-38, PR #12) now counts only queued/posted picks. Historical saturation from test-run picks cleared by fix. Monitor after next full test run. |
| `/stats` and `/leaderboard` avgClvPct always null | Medium | **Pending UTV2-46** — `resolveClvPayload()` in settlement-service stores raw closing line but never writes `clvRaw`/`beatsClosingLine`. Fix contracted (UTV2-46, `T2_CLV_SETTLEMENT_WIRING_CONTRACT.md`). |
| Historical pre-fix outbox rows noise in operator incident triage | Low | Open |
| API process requires manual restart for new code in dev | Low | Open |
| `NEXT_UP_EXECUTION_QUEUE.md` stale | High | **Stale** — last updated 2026-03-26; lists T1 Automated Grading as ACTIVE. That lane closed 2026-03-26. File is not currently maintained. Use `ISSUE_QUEUE.md` as the operative queue. |
| `system_snapshot.md` stale | Medium | **Stale** — last updated 2026-03-21; refers to Week 7 state. Proof IDs still valid as historical record but current-state claims are wrong. |
| Recap/downstream surfaces do not fully consume settlement truth | Low | **Partially resolved** — `GET /api/operator/recap` calls `computeSettlementSummary`. Full rollups/evaluation wiring deferred. |
| Catalog endpoint | Low | **CLOSED** — Fixed in Full Lifecycle Truth Verification sprint (commit ce7577b). |
| Smart Form zombie process | Low | **CLOSED** — `predev` hook + `scripts/kill-port.mjs` in `apps/smart-form/package.json`. |
| Enqueue gap | Medium | **CLOSED** — verified in T1 Full-Cycle Proof Rerun (2026-03-23). |

---

## Key Capabilities (current as of 2026-03-27)

### Submission and lifecycle
- Canonical submission intake live (API + Smart Form)
- Lifecycle transitions enforced (single-writer discipline)
- Market key normalization at submission time (`normalizeMarketKey()`)
- Conviction field → trust score in `metadata.promotionScores`
- Domain analysis at submission time (implied probability, edge, Kelly fraction)

### Promotion and delivery
- Promotion evaluation: best-bets policy (min score 70) + trader-insights policy (min score 80)
- Promotion scoring consumes domain analysis for edge, trust, and readiness
- Distribution outbox, worker delivery, receipts, and audit logs live
- 3 live Discord targets: canary, best-bets, trader-insights

### Grading and settlement
- `POST /api/grading/run` — automated grading against `game_results`; idempotent
- Settlement write path live: initial + correction chains + manual review
- Downstream settlement truth computed (effective settlement + loss attribution)
- CLV payload gap: `clvRaw`/`beatsClosingLine` not yet written (UTV2-46 pending)

### Operator surface
- `GET /api/operator/snapshot` — health, outbox, runs, settlements, entity health
- `GET /api/operator/stats` — capper win rate / ROI (avgClvPct null until UTV2-46)
- `GET /api/operator/leaderboard` — live (UTV2-44 CLOSED); avgClvPct null until UTV2-46 lands
- `GET /api/operator/participants` — player/team search
- `GET /api/operator/events` — upcoming events
- `GET /api/operator/recap` — settlement summary via domain

### Data ingestion
- `apps/ingestor/` live — populates `provider_offers` and `game_results` from SGO feed
- Entity resolution: events, participants, event_participants resolved from ingestor

### Discord bot
- Foundation: client, router, role-guard, api-client, command registry
- `/stats @capper` live
- `/leaderboard` live (UTV2-44 CLOSED)
- `deploy-commands` script works; CLIENT_ID mismatch prevents real guild deployment (see Risks)

### Smart Form
- Browser submission surface live (Next.js 14)
- Conviction field 1–10 wired
- Participant autocomplete typeahead (debounced, calls `/api/operator/participants`)

### Domain and computation foundation
- Pure computation: probability, devig, calibration, features, models, signals, bands, scoring, outcomes, evaluation, edge-validation, rollups, system-health, risk, strategy
- Verification control plane: scenarios, run history, archive

---

## Stale Authority Files

These files are no longer maintained and should not be used as current-state truth:

| File | Last Accurate | Do Not Use For |
|------|---------------|----------------|
| `docs/06_status/NEXT_UP_EXECUTION_QUEUE.md` | 2026-03-26 | Active lane queue (use `ISSUE_QUEUE.md`) |
| `docs/06_status/system_snapshot.md` | 2026-03-21 | Current state (use this file); proof IDs still valid as historical record |
| `docs/06_status/status_source_of_truth.md` | 2026-03-21 | Superseded by this file |
| `docs/06_status/current_phase.md` | 2026-03-21 | Superseded by this file |
| `docs/06_status/next_build_order.md` | 2026-03-21 | Superseded by this file |
| `docs/04_roadmap/active_roadmap.md` | 2026-03-21 | Current roadmap |

---

## Authority References

| Purpose | File |
|---------|------|
| **Active issue queue** | `docs/06_status/ISSUE_QUEUE.md` |
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Proof template (T1) | `docs/06_status/PROOF_TEMPLATE.md` |
| Rollback template (T1) | `docs/06_status/ROLLBACK_TEMPLATE.md` |
| /leaderboard contract | `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` |
| CLV wiring contract | `docs/05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` |
| Discord routing | `docs/05_operations/discord_routing.md` |
| Migration ledger | `docs/05_operations/migration_ledger.md` |

---

## Update Rule

Update this file at every sprint close. For T3 sprints, only the sprint log and test count need a new row. For T1/T2 sprints, update: tests, active lanes, key capabilities, open risks.

Do not let this file go more than 72 hours without a review against `ISSUE_QUEUE.md`.
