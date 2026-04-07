# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md`.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Operational work queue: Linear (live) | `docs/06_status/ISSUE_QUEUE.md` (historical record)**

## Last Updated

2026-04-07 — **PI-M5 platform readiness closure (UTV2-356). PR #162 merged (ops hardening). Main CI green (run 24062213123).**
Migration 011 (`picks.player_id` FK) applied. `pnpm supabase:types` clean: 2367 lines. 43/43 migrations applied, head `202604070011`. All PI-M5 acceptance criteria met: CI green, types clean, migration audit clean, deployment runbook updated with migration rollback procedure, alert surface artifacts present (pipeline-health, worker-alert-check, INGESTOR_RUNTIME_SUPERVISION), lint/type-check/test/outbox all pass. `pnpm pi-m5:verify` exits 0. PI-M5 (UTV2-356) → Done.

2026-04-05 — **Migration batch 007–010 applied to live Supabase. Types regenerated. Linear board normalized.**
Migrations applied: `picks_current_state` view (007), `sport_market_types` drop (008), NBA alias completion (009, UTV2-394 Done), MLB taxonomy completion (010, UTV2-391 Done — stat_types, market_types, combo_stat_types, provider_market_aliases for 1B/2B/3B/HRR/ER/HA/PO). PRs #153–#157 merged (picks FK columns live: `capper_id`, `market_type_id`, `sport_id`). `pnpm supabase:types` regenerated — 2357 lines, picks_current_state view now typed, sport_market_types removed. Tests: 188/188 pass. Type-check: clean. M5 Linear board: UTV2-364/343/369 closed; UTV2-353 deferred to Backlog; UTV2-356/360/335 have AC added (remain Ready, awaiting runtime preconditions). UTV2-320 (NBA baseline) still blocked — awaiting settled pick data per UTV2-335 precondition.

2026-04-04 — **Full state reconciliation.** Linear queue, repo, and docs aligned as of `bdc237f`. UTV2-386 shipped (per-bookmaker odds capture — `bookmaker_key` column live in Supabase, SGO byBookmaker extraction active, CLV now prefers Pinnacle closing line). UTV2-387 (Smart Form autocomplete) marked Done — fix was in commit `239781c`. All M5 production-readiness closure issues (UTV2-335, 343, 353, 356, 360, 364, 369) moved to Ready for PM assessment. NBA/NFL/NHL baseline models (UTV2-320, 322, 323) moved to Ready alongside active UTV2-321 (MLB, In Progress). Test baseline: `pnpm test` 188 pass, smart-form 87 pass, ingestor 51 pass. All gates green.

2026-04-04 — **UTV2-385 shipped (game-line results).** Migration `202604040003` adds partial unique index for null-participant game_results. `results-resolver.ts` no longer skips game-line markets — ML/spread/totals now write to DB with null participant_id. `EventRepository.listByName()` added. Grading service handles `game_total_ou` picks end-to-end via event-name resolution. ML/spread grading deferred pending SGO score format confirmation. **T1: migration `202604040003` needs Supabase apply before full grading proof.** UTV2-384 marked Done.

2026-04-04 — **SGO Pro trial active (6-day window). Results pipeline rewritten.** SGO Pro trial started; Odds API disabled for trial period. Results pipeline (`results-resolver.ts`) rewritten to use `odds.<oddID>.score` per SGO support recommendation — replaces incorrect `event.results.game` approach. `extractScoredMarkets()` added to sgo-fetcher. 90-day historical backfill running (`scripts/backfill-sgo-history.ts`, 2026-01-04 → 2026-04-03). New Linear issues: UTV2-384 (auto-settle E2E proof), UTV2-385 (game-line grading schema), UTV2-386 (byBookmaker capture). Provider knowledge base documented at `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md`. All gates green. 47 ingestor tests passing.

2026-04-04 — **All GP, SG, CS, DS milestones closed.** GP-M1 through GP-M5 Done (system-generated pick engine complete). SG-M1 through SG-M5 Done (settlement/grading/recaps — manual settlement proven). CS-M5 Done (Smart Form production-ready). DS-M4/M5 Done. Active: UTV2-321 (MLB baseline model, In Progress, needs backfill data). UTV2-384 (auto-settle E2E proof via SGO odds.score, next priority). Phase 7 (Syndicate Lane) awaiting PM approval.

2026-04-03 — **Sprint D+ hardening and Smart Form UX complete.** Contracts ratified: Recap (UTV2-311), Discord Embed (UTV2-312), Event Identity (UTV2-309), Board Cap Policy (UTV2-284). Odds API player-prop canonicalization shipped (UTV2-308, PR #136). Smart Form UX: DB-backed capper dropdown (UTV2-261), sport button UI (UTV2-262), math runtime proof (UTV2-257) — all merged PR #137. CI baseline fixed (operator-web path test platform-agnostic). Board cap: `perSport: 3` currently saturating for single-capper NBA — PM decision pending on UTV2-284. Next: UTV2-303 (Smart Form participant/stat constraint, Codex).

2026-04-03 — **Branch/worktree convergence complete.** All Sprint A–D feature branches and ~60 stale worktrees cleared. `main` is the single source of truth.

2026-04-01 — **Sprint A through D COMPLETE.** Sprint D (Intelligence v1): real edge against market consensus, EdgeSource tracking in promotion snapshots, CLV participant fallback, walk-forward backtesting infrastructure, scoring weight validation, odds API moneyline normalization, submission atomicity hardening. All gates green. Phase 7 (Syndicate Lane) awaiting PM approval.

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | **All pass** — 0 failures. `pnpm test` 188 pass (main `51e295a`). Smart-form: 87 pass. Ingestor: 51 pass. All gates green. |
| Gates | `pnpm lint` PASS. `pnpm type-check` PASS. `pnpm test` PASS. `pnpm build` PASS. All green. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) per `SPRINT_MODEL_v2.md` |
| Milestone | **SGO Pro trial (6-day window, 2026-04-04).** Migrations 007–010 live. Picks FK columns (`capper_id`, `market_type_id`, `sport_id`) live in Supabase. UTV2-391/394 Done. M5 closure: 364/343/369 Done, 353 Backlog, 356/360/335 Ready (AC added, blocked on runtime preconditions). Phase 7 awaiting PM approval. |
| Provider | **SGO Pro active.** Odds API suspended for trial period. Historical backfill complete: 329k provider_offers rows (2026-01-05 → 2026-04-04). Per-bookmaker rows (Pinnacle/DK/FD/BetMGM) now captured via byBookmaker. Results pipeline uses `odds.<oddID>.score`. Knowledge base: `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md`. |
| Roadmap | Active: none (UTV2-321 MLB baseline stalled pending backfill data). Ready: UTV2-320 (NBA baseline, blocked on settled picks), UTV2-322/323 (NFL/NHL baselines), UTV2-398 (picks_current_state type). Phase 7 (Syndicate Lane) awaiting PM approval. |

## Honest Assessment (forensic audit 2026-03-31)

| Layer | Grade | Reality |
|-------|-------|---------|
| **Infrastructure** | 8/10 | Lifecycle FSM, outbox delivery, circuit breakers, atomic claims, rollout controls, simulation mode, writer authority — production-grade. |
| **Intelligence** | 6/10 | Real edge live: model probability vs devigged Pinnacle/consensus/SGO market data. EdgeSource tracked in every promotion snapshot. Multiple odds providers (SGO + Odds API: Pinnacle, DK, FD, MGM). Walk-forward backtesting infrastructure in `clv-weight-tuner.ts` (not yet operationalized). Calibration still dead code. Scoring weights unvalidated against outcomes — infrastructure exists but no scheduled runs. |
| **Product** | 5/10 | Discord delivery works but provides no decision support. No confidence, edge, thesis, or Kelly in pick embeds. Recaps lack sample size context. |

**Launch positioning:** Pick operations + distribution + tracking platform with real market edge computation. Sprint D (Intelligence v1) is complete. NOT a syndicate-level intelligence system — that requires Phase 7 (feedback loop, 500+ graded picks, UX hardening).

**Sprint A resolved:** Lint fixed (G1 unblocked). Submission dedup (UNIQUE index). Settlement dedup (atomic claim + UNIQUE constraint). Atomic promotion (compensating rollback). Retry model (pending + backoff). Post-send reconciliation. CLV capper identity hotfix. Exposure gate lifecycle fix.

**Pending migrations (must apply to Supabase before production):**
- `202603310001_submission_idempotency.sql` — adds `idempotency_key` column + UNIQUE index to `picks`
- `202603310002_settlement_idempotency.sql` — adds UNIQUE partial index on `settlement_records(pick_id, source)`

## Gate Notes (verified 2026-04-01 — Sprint D complete)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | All suites 0 failures. Verified 2026-04-03 (main `fbae181`). CI fixed — operator-web test was hardcoding Windows path. |
| `pnpm verify` (full chain) | PASS | Exit 0. |
| Playwright e2e | PASS | **188/188** — all phases (Phase 1, Phase 2, Wave 3, Wave 4). Verified 2026-03-31. |

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

**Note:** `apps/smart-form` tests run via `pnpm --filter @unit-talk/smart-form test` only — not in root `pnpm test`.

---

## Live Routing

| Target | Status | Detail |
|--------|--------|--------|
| `discord:canary` | **LIVE** | Permanent control lane. Never removed. |
| `discord:best-bets` | **LIVE** | Real channel `1288613037539852329`. |
| `discord:trader-insights` | **LIVE** | Real channel `1356613995175481405`. |
| `discord:recaps` | **LIVE** | Real channel `1300411261854547968`. Daily/weekly recap posts. |
| `discord:exclusive-insights` | Code merged — activation deferred | Real channel `1288613114815840466`. Promotion evaluation, distribution service wired (UTV2-87 DONE). Not in `UNIT_TALK_DISTRIBUTION_TARGETS` — live activation requires explicit PM approval. |
| `discord:game-threads` | Blocked | Thread routing not implemented. |
| `discord:strategy-room` | Blocked | DM routing not implemented. |

---

## Current Milestone (M13 — ACTIVE)

M12 closed 2026-03-28 at 691/691 tests. Proof: `out/sprints/M12/2026-03-28/m12_closure_proof.md`.

| Item | Tier | Lane | Status |
|------|------|------|--------|
| M13 UTV2-102 Recap runtime hardening | T2 | claude | DONE commit `4b5ccd7` |
| M13 UTV2-103 Full lifecycle proof refresh | T1 | claude | DONE 2026-03-28 |
| M13 UTV2-104 Agent operating model refresh | T1 | claude | DONE commit `8311cd9` |
| M13 UTV2-105 Grading participant linkage | T2 | codex | DONE PR #43 |
| M13 UTV2-106 Worker runtime authority contract | T1 | claude | DONE commit `b403e98` |
| M13 UTV2-107 Worker runtime activation | T2 | codex | DONE PR #44 |
| M13 UTV2-108 Status authority refresh | T1 | claude | DONE commit `f92f52e` |
| M13 UTV2-109 Worker runtime visibility | T2 | codex | DONE PR #45 |
| M13 UTV2-112 AlertAgent line movement contract | T1 | claude | DONE PR #47 |
| M13 UTV2-59 AlertAgent line movement detection | T2 | codex | DONE PR #48 |
| M13 UTV2-113 discord:recaps activation contract | T1 | claude | DONE PR #50 |
| M13 UTV2-26 Incident/rollback plan | T1 | claude | DONE PR #52 |
| M13 UTV2-90 discord:recaps runtime activation | T2 | codex | DONE PR #53 |
| M13 UTV2-74 API quota tracking | T2 | codex | DONE PR #54 |
| M13 UTV2-114 AlertAgent notification layer | T2 | claude | DONE PR #55 |
| M13 UTV2-87 exclusive-insights contract | T1 | claude | DONE PR #56 → UTV2-87 READY (codex) |
| M13 UTV2-69 Hedge detection contract | T2 | claude | DONE PR #56 → UTV2-69 READY (codex) |

### M12 Items (CLOSED 2026-03-28)

| Item | Tier | Lane | Status |
|------|------|------|--------|
| M12 UTV2-68 SGO results auto-ingest | T2 | codex | DONE (already implemented) |
| M12 UTV2-69 Grading cron | T3 | codex | DONE PR #41 |
| M12 UTV2-70 RecapAgent scheduled Discord posts | T2 | codex | DONE PR #42 |
| M12 UTV2-71/UTV2-101 M12 closure verification | T1 | claude | DONE 2026-03-28 |

### M11 Items (CLOSED)

| Item | Tier | Lane | Status |
|------|------|------|--------|
| M11 UTV2-61 Recap CLV/stake enrichment | T3 | codex | DONE PR #37 |
| M11 UTV2-62 Dead-letter outbox promotion | T2 | codex | DONE PR #35 |
| M11 UTV2-63 Dead-letter operator surface | T3 | codex | DONE PR #39 |
| M11 UTV2-64 DeviggingService submission wiring | T2 | codex | DONE PR #36 |
| M11 UTV2-65 M10 closure verification | T1 | claude | DONE |
| M11 UTV2-66 Discord bot startup entry point | T2 | augment | DONE PR #38 |
| M11 UTV2-67 Kelly sizing at submission | T2 | codex | DONE PR #40 |

---

## Wave 1+2 Hardening (2026-03-29)

45 issues created (UTV2-115–158). All triaged. Claude queues complete. **Wave 1 Codex DONE** (PRs #64–#67 merged 2026-03-29). Wave 2 Codex queue fully unblocked.

### Wave 1 Codex Queue — ALL DONE (PRs #64–#67, merged 2026-03-29)

| Issue | Task | PR | Status |
|---|---|---|---|
| UTV2-115 | Fail-closed API runtime mode | #65 | **DONE** |
| UTV2-116 | Fail-closed operator-web runtime mode | #67 | **DONE** |
| UTV2-117 | API request body size cap | #65 | **DONE** |
| UTV2-118 | API submission rate limiting | #65 | **DONE** |
| UTV2-119 | Worker stale-claim reaper | #66 | **DONE** |
| UTV2-120 | Worker heartbeat / watchdog | #66 | **DONE** |
| UTV2-121 | Smart-form into root pnpm verify | #67 | **DONE** |
| UTV2-123 | Structured logging + correlation IDs | #64 | **DONE** |
| UTV2-128 | HTTP-level integration test suite | #65 | **DONE** |
| UTV2-140 | CI command manifest for Discord bot | #67 | **DONE** |

### Wave 1 Claude Queue — ALL DONE

| Issue | Task | Status |
|---|---|---|
| UTV2-138 | Status authority refresh | **DONE** 2026-03-29 |
| UTV2-122 | PickMetadata contract | **DONE** 2026-03-29 — `PICK_METADATA_CONTRACT.md` |
| UTV2-125 | Alert agent extraction contract | **DONE** 2026-03-29 — `ALERT_AGENT_EXTRACTION_CONTRACT.md` |
| UTV2-147 | Runtime mode contract | **DONE** 2026-03-29 — `RUNTIME_MODE_CONTRACT.md` |
| UTV2-139 | Supabase hardening audit | **DONE** 2026-03-29 — `supabase_hardening_audit_2026-03-29.md` |

### Wave 2 Claude Queue — ALL DONE

| Issue | Task | Status |
|---|---|---|
| UTV2-148 | Delivery adapter hardening contract | **DONE** 2026-03-29 — `DELIVERY_ADAPTER_HARDENING_CONTRACT.md` |
| UTV2-124 | Discord circuit breaker contract | **DONE** 2026-03-29 — `DISCORD_CIRCUIT_BREAKER_CONTRACT.md` |
| UTV2-136 | Model registry + score weights bug fix | **DONE** 2026-03-29 — `MODEL_REGISTRY_CONTRACT.md` |
| UTV2-145 | Replayable scoring contract | **DONE** 2026-03-29 — `REPLAYABLE_SCORING_CONTRACT.md` |
| UTV2-149 | Member tier model contract | **DONE** 2026-03-29 — `MEMBER_TIER_MODEL_CONTRACT.md` |
| UTV2-129 | Promotion target registry contract | **DONE** 2026-03-29 — `PROMOTION_TARGET_REGISTRY_CONTRACT.md` |
| UTV2-132 | Docs taxonomy cleanup | **DONE** 2026-03-29 — 14 files deleted, `docs_audit_2026-03-29.md` |
| UTV2-157 | Proof bundle schema | **DONE** 2026-03-29 — `PROOF_BUNDLE_SCHEMA.md` |

### Wave 2 Codex Queue — Ready (awaiting Wave 1 completion or independent)

| Issue | Task | Tier | Blocked By |
|---|---|---|---|
| UTV2-148 | Delivery adapter hardening (impl) | T2 | — |
| UTV2-124 | Discord circuit breaker (impl) | T1 | UTV2-148 |
| UTV2-126 | Alert agent extraction (impl) | T2 | — |
| UTV2-127 | Operator-web route modules | T2 | — |
| UTV2-131 | Snapshot pagination | T2 | — |
| UTV2-141 | API route modules | T2 | — |
| UTV2-143 | Alert agent observability | T2 | — |
| UTV2-144 | Recap/grading observability | T2 | — |
| UTV2-145 | Replayable scoring (impl) | T2 | UTV2-136 impl |
| UTV2-150 | Upgrade/trial audit trail | T2 | **DONE** PR #77 |
| UTV2-129 | Target registry (impl) | T2 | — |
| UTV2-130 | Tier authority drift detection | T2 | UTV2-129 impl |
| UTV2-134 | Portfolio/exposure tracking | T3 | — |
| UTV2-158 | Repo map modernization | T3 | — |

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
| Board cap `perSport: 3` will saturate for single-capper NBA system after 3 qualifying picks | Medium | **Open** — UTV2-284 In Review. PM decision required: keep 3 (document as intentional) or raise to ~10. Board currently at 100% (5/5 perSlate cap). |
| Discord CLIENT_ID mismatch — `deploy-commands` may fail | Low | **CLOSED** — UTV2-59 verified 3 commands, UTV2-65 confirmed 5 commands (post /help + /recap). Guild deploy current. |
| Smart Form `confidence` field missing | Resolved | **CLOSED** — UTV2-49 merged. `confidence = capperConviction / 10` wired. Score avg lifted ~20pts. |
| Board caps (perSlate=5) may re-saturate | Low | **CLOSED** — UTV2-169 shipped. Board utilization in operator snapshot with warning at >= 80%, configurable cap. |
| Historical pre-fix outbox rows noise in operator incident triage | Low | **CLOSED** — UTV2-168 shipped. `OUTBOX_HISTORY_CUTOFF` filters pre-2026-03-20 rows from queries and counts. |
| `database.types.ts` hand-edit gap | Medium | **CLOSED** — migrations 014-017 applied via `supabase db push`; real generated types committed 2026-03-29 |
| Discord trial role auto-revoke on expiry not yet implemented | Low | Open — ratified 2026-03-29; requires scheduler → bot API → `GuildMember.roles.remove()` write path |
| API process requires manual restart for new code in dev | Low | Open |
| `system_snapshot.md` stale | Low | Last updated 2026-03-21. Proof IDs still valid as historical record; current-state claims are wrong. Use `PROGRAM_STATUS.md`. |
| `production_readiness_checklist.md` stale | Low | Last updated 2026-03-26. Use `ISSUE_QUEUE.md` for current lane state. |
| Production readiness canary not yet executed | Medium | **Plan ratified** (`PRODUCTION_READINESS_CANARY_PLAN.md`). G12 gate OPEN. Requires 7-day canary period with >= 30 graded picks. Supersedes shadow validation after V1 synthetic data discovery. |

---

## Key Capabilities (current as of 2026-04-01, post-Sprint D)

### Submission and lifecycle
- Canonical submission intake live (API + Smart Form)
- Lifecycle transitions enforced with typed errors: `InvalidTransitionError`, `InvalidPickStateError` (UTV2-175)
- Atomic claim idempotency: `atomicClaimForTransition()` prevents double-posting/settling via conditional UPDATE (UTV2-176)
- Writer authority: per-field `assertFieldAuthority()` enforces single-writer discipline in code (UTV2-177)
- Market key normalization at submission time (`normalizeMarketKey()`)
- Conviction field → trust score in `metadata.promotionScores`
- Domain analysis at submission time: implied probability, edge, devig (`metadata.deviggingResult`), Kelly sizing (`metadata.kellySizing`) — all fail-closed (UTV2-64, UTV2-67)
- `findLatestMatchingOffer()` sorts by `snapshot_at` DESC — always uses most recent offer (UTV2-67)

### Promotion and delivery
- Promotion evaluation: best-bets policy (min score 70) + trader-insights policy (min score 80)
- Promotion scoring consumes domain analysis for edge, trust, and readiness
- **Real edge integration (Sprint D):** `real-edge-service.ts` computes model probability vs devigged Pinnacle → multi-book consensus → SGO market data. Falls back to confidence-delta when no market data available.
- **EdgeSource tracking (UTV2-222/223):** Every promotion snapshot records `scoreInputs.edgeSource` (`'real-edge' | 'consensus-edge' | 'sgo-edge' | 'confidence-delta' | 'explicit'`). `DomainAnalysis.confidenceDelta` is now the canonical field; `edge` kept for backward compat with existing DB records.
- Distribution outbox, worker delivery, receipts, and audit logs live
- 3 live Discord targets: canary, best-bets, trader-insights
- Dead-letter promotion: `attempt_count >= 3` consecutive failures → `dead_letter` status via `markDeadLetter()` (UTV2-62)
- Dead-letter visible in operator snapshot: `counts.deadLetterOutbox`; distribution health degrades when > 0 (UTV2-63)

### Grading and settlement
- `POST /api/grading/run` — automated grading against `game_results`; idempotent
- Settlement write path live: initial + correction chains + manual review
- Downstream settlement truth computed (effective settlement + loss attribution)
- CLV wired: `computeAndAttachCLV()` called at graded settlement; `clvRaw`/`clvPercent`/`beatsClosingLine` written as top-level payload keys (UTV2-46 CLOSED)
- **CLV participant fallback (UTV2-224):** `resolveParticipantId()` falls back to `metadata.player` + `metadata.sport` for picks submitted without explicit `participant_id` (smart-form, discord-bot path)
- **Walk-forward backtesting (UTV2-234):** `runWalkForwardBacktest()` + `testAllComponentSignificance()` in `packages/domain/src/clv-weight-tuner.ts`. Infrastructure live; not yet operationalized (no scheduled runs). Scoring profile weights remain static pending outcome data accumulation.

### Operator surface
- `GET /api/operator/snapshot` — health, outbox, runs, settlements, entity health
- `GET /api/operator/stats` — capper win rate / ROI / avgClvPct (populates for picks with closing lines)
- `GET /api/operator/leaderboard` — ranked capper leaderboard; avgClvPct populates for picks with closing lines
- `GET /api/operator/participants` — player/team search
- `GET /api/operator/events` — upcoming events
- `GET /api/operator/recap` — settlement summary via domain
- `GET /api/operator/performance` — comparative performance: time windows (today/7d/30d/mtd), capper vs system, approved/denied/held decision outcomes, per-sport, per-source, CLV%, avg stake, operator insights (Wave 4)
- `GET /api/operator/intelligence` — intelligence layer: recent form (last 5/10/20) for all slices, score band quality analysis, decision quality metrics, feedback loop (score-right / review-right), degradation warnings (Wave 4)

### Command Center (Wave 4 — Intelligence Layer)
- Next.js 14 app at `apps/command-center` (port 4300) — reads from operator-web, writes through API
- `/` — dashboard: 6 lifecycle health signals, exceptions, stats summary, pick lifecycle table
- `/picks-list` — filterable pick search with pagination
- `/review` — review queue (approve/deny/hold)
- `/held` — held picks queue with return/resolve actions
- `/exceptions` — 5 exception categories with intervention actions (retry, rerun, force promote)
- `/performance` — comparative performance intelligence: time windows, capper vs system, decision outcomes, by sport, by source, CLV%, avg stake, operator insights, capper leaderboard
- `/intelligence` — score quality (band segmentation, score-vs-outcome correlation), decision quality (approved win rate, denied would-have-won, ROI delta), recent form grid (last 5/10/20), feedback loop table
- `/decisions` — decision audit with filter tabs (all/approved/denied/held/returned)
- `/interventions` — intervention audit log
- `/picks/[id]` — 8-section pick lifecycle trace with settlement/correction forms
- 188 Playwright e2e tests verify all surfaces

### Data ingestion
- `apps/ingestor/` live — populates `provider_offers` and `game_results` from SGO feed
- **Odds API ingest live (Sprint D):** Pinnacle + DraftKings + FanDuel + BetMGM via `apps/ingestor/src/ingest-odds-api.ts`. Paired spreads/totals and moneyline offers all normalize to `overOdds`/`underOdds` in canonical `provider_offers`.
- **Moneyline normalization (UTV2-249):** h2h markets use `buildMoneylineOffer()` → participant-specific `moneyline` market key with selection/opposing odds in `overOdds`/`underOdds`. Downstream `real-edge-service.ts` resolves by canonical market key + participant.
- **Player-prop canonicalization (UTV2-308, PR #136):** Odds API ingest now fetches `player_points`, `player_rebounds`, `player_assists`, `player_threes` markets. Player participants matched by display name to canonical `participants` records; linked as `role: 'competitor'` in `event_participants`. Unmatched players skip with warning. 37 ingestor tests.
- **Event identity contract ratified (UTV2-309):** `docs/05_operations/EVENT_IDENTITY_CONTRACT.md` — provider-scoped `external_id`, no cross-provider dedup, Option B1 (name-match only) authorized for player canonicalization.
- Entity resolution: events, participants, event_participants resolved from ingestor

### Member tier model
- `member_tiers` table: migration 017 on main. Append-only, `effective_until` null = active. Tier CHECK: `free | trial | vip | vip-plus | capper | operator` (hyphens canonical). Source CHECK: `discord-role | manual | system`.
- `MemberTier` type + `memberTiers` const exported from `@unit-talk/contracts`
- `MemberTierRepository` interface + `InMemoryMemberTierRepository` + `DatabaseMemberTierRepository` in `@unit-talk/db`
- Operator snapshot `memberTiers.counts`: live query, best-effort fallback on error
- **Live:** migrations 014-017 applied 2026-03-29; real generated types on main
- `POST /api/member-tiers` endpoint live in `apps/api`; `createMemberTierSyncHandler()` wired in discord-bot `main.ts` — both `guildMemberUpdate` handlers run independently (PR #78)
- Trial expiry: `runTrialExpiryPass()` scheduler runs hourly in API process; `TRIAL_DURATION_DAYS=7` canonical (PR #77)
- **Ratified policy:** Trial = full VIP surface set (incl. Trader Insights). Discord role auto-revoke on expiry: ratified, not yet implemented.
- `MEMBER_ROLE_ACCESS_AUTHORITY.md` ratified 2026-03-29 — supersedes `ROLE_ACCESS_MATRIX.md`

### Discord bot
- Foundation: client, router, role-guard, api-client, command registry
- Process entry point live: `apps/discord-bot/src/main.ts` — connects client, loads registry, attaches handler, calls `client.login()` (UTV2-66)
- Bot confirmed live: `Ready as Unit Talk#9476`
- `/stats @capper` live
- `/leaderboard` live
- `/pick` submission command live (UTV2-53)
- `/help` command live (UTV2-50)
- `/recap` capper self-service settled picks command live (UTV2-58); CLV% and stake units in embed (UTV2-61)
- `responseVisibility` flag on `CommandHandler` — fail-closed (private unless explicitly `'public'`)
- Guild deploy current: 5 commands registered as of 2026-03-27 (UTV2-65 confirmed)

### Alert agent
- Line movement detection: `runAlertDetectionPass()` — scans `provider_offers` snapshots, classifies `watch`/`notable`/`alert-worthy` by velocity + magnitude (UTV2-59 PR #48)
- Notification layer: `runAlertNotificationPass()` — DB-backed cooldown, tier-based Discord routing: `notable`→canary (30min), `alert-worthy`→canary+trader-insights (15min), `ALERT_DRY_RUN` kill switch (UTV2-114 PR #55)
- Both passes run in `alert-agent.ts` scheduler tick; fail independently
- Hedge detection contract ratified (UTV2-69 READY); exclusive-insights activation contract ratified (UTV2-87 READY)

### UltraPlan Phase 0+1 Hardening (2026-04-06/07)

**Phase 0A — Truth Restoration**
- Linear CLI fixed: `team(key:)` → `team(id:)` with UUID. `LINEAR_TEAM_ID` wired. Commit `3437be2`.
- `.gitignore` cleaned: smart-form test-results + `.code-workspace` excluded.

**Phase 0B — Worker Supervisor (T1-lite)**
- `scripts/worker-supervisor.ts` — detached supervisor spawns child worker, exponential backoff (5s–30s), writes state to `out/worker-runtime/state.json`, health check via `system_runs.worker.heartbeat` + pending outbox count. Commit `e81702b`.
- `pnpm worker:start|stop|restart|status` scripts wired.

**Phase 1 — Runtime Hardening**
- Worker fail-closed atomic delivery: `persistenceMode` dispatch — `database` mode calls `claimNextAtomic`/`confirmDeliveryAtomic`, no silent fallback. `in_memory` path explicit for tests. Commit `670da32`.
- `GET /api/health/config` — feature availability signals: closingLines, clv, sharpConsensus, edge; derived from live DB. scoringProfile, persistenceMode, runtimeMode, boardCaps. Commit `670da32`.
- Worker heartbeat alert check: `scripts/worker-alert-check.ts` — `pnpm worker:alert-check` queries `system_runs.worker.heartbeat`, emits CRITICAL + Discord canary alert if stale beyond threshold. Commit `670da32`.
- 188/188 tests pass, type-check clean.
- `discord:exclusive-insights` status corrected in this file: activation deferred, not LIVE. Commit `0b4ad2e`.

### Worker runtime
- Worker process activated: `UNIT_TALK_WORKER_AUTORUN=true`, healthy = outbox draining, receipts written, no dead-letter (UTV2-107 PR #44)
- Worker runtime visibility in operator snapshot: `workerRuntime` health signal, last-run summary, outbox drain rate (UTV2-109 PR #45)
- **Simulation mode** (UTV2-156): `UNIT_TALK_SIMULATION_MODE=true` runs full pipeline but replaces Discord delivery with simulation receipts (`worker.simulation`). Operator snapshot detects from receipt data, not just env var (UTV2-171 desync fix).
- **Rollout controls** (UTV2-154): per-target `rolloutPct` (0-100) + `sportFilter`. Deterministic FNV-1a hash for stable sampling. `UNIT_TALK_ROLLOUT_CONFIG` env var. Kill switch via `rolloutPct=0`. Operator dashboard shows rollout config with partial-rollout badge.
- Safe activation pipeline complete: simulate → canary → gradual rollout → full activation

### Settlement recap
- `postSettlementRecapIfPossible()` in `grading-service.ts` — fires after each newly graded pick (UTV2-57)
- Posts embed to pick's original Discord delivery channel; channel resolved from `distribution_receipts` → outbox target → `UNIT_TALK_DISCORD_TARGET_MAP`
- No-ops if `DISCORD_BOT_TOKEN` absent or no delivery receipt found
- **DB-backed idempotency** (UTV2-170): `system_runs` record with `run_type='recap.post'` prevents duplicate posts on process restart. In-memory guard preserved as fast-path.

### Smart Form
- Browser submission surface live (Next.js 14)
- Conviction field 1–10 wired
- Participant autocomplete typeahead (debounced, calls `/api/operator/participants`)
- **Sport button UI (UTV2-262, PR #137):** sport selector replaced with button grid — faster selection, drives downstream field filtering
- **DB-backed capper dropdown (UTV2-261, PR #137):** `CapperDefinition { id, displayName }` type in contracts; searchable dropdown replaces free-text; `isValidCapper()` updated to `.some(c => c.id === capper)`
- **Math runtime proof (UTV2-257, PR #137):** `scripts/utv2-257-runtime-proof.ts` verifies live operator surfaces for domain analysis, promotion, delivery chain

### Domain and computation foundation
- Pure computation: probability, devig, calibration, features, models, signals, bands, scoring, outcomes, evaluation, edge-validation, rollups, system-health, risk, strategy
- Verification control plane: scenarios, run history, archive

### Observability
- Structured JSON logging via `@unit-talk/observability` with `createLogger()`, correlation IDs, request fields (UTV2-123)
- **Centralized logging** (UTV2-153): Loki + Grafana via `createLokiLogWriter()` + `createDualLogWriter()`. Batched HTTP push, env-var activated (`LOKI_URL`). `docker-compose.logging.yml` for local dev.
- Board utilization monitoring in operator snapshot: `boardUtilization` with configurable cap, warning at >= 80%, saturated at >= 100% (UTV2-169)
- Historical outbox noise filtered: `OUTBOX_HISTORY_CUTOFF` excludes pre-2026-03-20 rows from operator queries (UTV2-168)

### Cutover readiness
- **Shadow validation plan ratified** (UTV2-25): 8 comparison surfaces, discrepancy taxonomy, evidence bundle, sign-off authority. G12 gate added to `migration_cutover_plan.md` — required for cutover.
- **V1 data extraction audit complete** (UTV2-172): all V1 surfaces mapped. V1 found to contain only synthetic test data — shadow comparison against V1 invalidated.
- **Production readiness canary plan ratified** (supersedes shadow validation plan): 7-day canary period with real picks, grading spot-checks, delivery health monitoring, evidence bundle. See `PRODUCTION_READINESS_CANARY_PLAN.md`.
- **Cutover risk audit complete** (UTV2-27): 3 stale risks closed (R-07, R-08, R-11). Follow-on issues all shipped: UTV2-168 (outbox cleanup DONE), UTV2-169 (board cap monitoring DONE), UTV2-170 (recap idempotency DONE, R-06 closed).
- **V1 lifecycle safety foundation ported** (UTV2-175, 176, 177): typed transition errors, atomic claim idempotency, writer authority enforcement. 46 new lifecycle tests.
- **Cutover gate status**: G1 PASS (lint fixed). G2-G9, G11 PASS. G10 acceptable. **G12 OPEN** (canary not started). Sprint A blockers resolved.
- **Sprint A safety fixes shipped**: Submission idempotency (UTV2-183). Settlement idempotency (UTV2-184). Atomic promotion rollback (UTV2-185). Enqueue failure visibility (UTV2-186). Post-send reconciliation (UTV2-187). Retry model fix (UTV2-188). CLV capper identity (UTV2-212). Exposure gate lifecycle (UTV2-213).

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
| `docs/06_status/production_readiness_checklist.md` | 2026-03-26 | Lane state (use `ISSUE_QUEUE.md`) |

---

## Authority References

| Purpose | File |
|---------|------|
| **Operational work queue** | Linear (live queue) — `docs/06_status/ISSUE_QUEUE.md` is historical record only |
| **Active program status** | this file |
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Platform surfaces | `docs/03_product/PLATFORM_SURFACES_AUTHORITY.md` |
| Member role access | `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md` |
| Discord commands | `docs/03_product/DISCORD_COMMAND_CATALOG.md` |
| Docs follow-on queue | `docs/06_status/T1_DOCS_FOLLOW_ON_QUEUE.md` |
| Proof template (T1) | `docs/06_status/PROOF_TEMPLATE.md` |
| Rollback template (T1) | `docs/06_status/ROLLBACK_TEMPLATE.md` |
| /leaderboard contract | `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` |
| Recap contract | `docs/05_operations/RECAP_CONTRACT.md` |
| Discord embed contract | `docs/discord/DISCORD_EMBED_CONTRACT.md` |
| Event identity contract | `docs/05_operations/EVENT_IDENTITY_CONTRACT.md` |
| Board cap policy | `docs/05_operations/BOARD_CAP_POLICY.md` |
| CLV wiring contract | `docs/05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` |
| Discord routing | `docs/05_operations/discord_routing.md` |
| Migration ledger | `docs/05_operations/migration_ledger.md` |
| Production readiness canary | `docs/05_operations/PRODUCTION_READINESS_CANARY_PLAN.md` |
| Migration cutover plan | `docs/05_operations/migration_cutover_plan.md` |
| Simulation mode contract | `docs/05_operations/SIMULATION_MODE_CONTRACT.md` |
| Rollout controls contract | `docs/05_operations/ROLLOUT_CONTROLS_CONTRACT.md` |
| V1 data extraction audit | `docs/05_operations/V1_DATA_EXTRACTION_AUDIT.md` |

---

## Update Rule

Update at **T1/T2 sprint close only**. Update: milestone summary, key capabilities, open risks.

**T3 sprints:** update Linear (mark DONE) only. No `PROGRAM_STATUS.md` update required.

Active lane state lives in Linear. `ISSUE_QUEUE.md` is a historical record — do not use it as the live queue.
