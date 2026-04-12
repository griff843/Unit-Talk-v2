# Program Status — Archive

> Historical record archived from `PROGRAM_STATUS.md` on 2026-04-12.
> Phases 1–6 are closed. This file preserves the full historical log for audit.
> Current status lives in `PROGRAM_STATUS.md`.

---

## Closed Phase History (Last Updated entries, pre-Phase 7)

2026-04-10 — **Phase 6 COMPLETE — 7/7 proof assertions PASS (live DB + runtime). Locked roadmap complete.**
UTV2-481 (P6-03: Phase 6 runtime proof, commit `b74c384`) Done — RESULT: 7/7 PASS. Attribution view (204 rows, 0 broken chains), market_family_trust table live, auth gate confirmed (auth.ts:47), audit record written (tuningRunId `48f9c032`), Phase 6 boundary enforced at DB layer. Tuning rows: VACUOUS PASS (board picks unsettled — will populate when settlement data accumulates). Phase 6 gate CLOSED.
UTV2-480 (P6-02: market-family trust and threshold tuning, commit `d922eea`) Done. `market_family_trust` table (migration `202604100002`), `runMarketFamilyTuning()` service with MIN_SAMPLE=5, `POST /api/board/run-tuning` (operator-only), 8/8 unit tests.
UTV2-479 (P6-01: model performance and outcome attribution wiring, commit `2a18f29`) Done. Creates `v_governed_pick_performance` view (migration `202604100001`) joining `picks → pick_candidates → syndicate_board → market_universe → settlement_records`. Adds `GET /api/board/performance` (operator-web), `GovernedPickPerformanceRow` type, `fetchBoardPerformance()` CC helper. Full attribution chain queryable.

2026-04-10 — **Phase 5 COMPLETE — 7/7 proof assertions PASS (live DB). Gate closed.**
UTV2-476 (P5-01: governed candidate-to-pick write path, PR #214, commit `9766ef9`) Done. UTV2-477 (P5-02: CC board queue review surface, PR #215, commit `919599a`) Done. UTV2-478 (P5-03: DB truth + lifecycle + audit proof, commit `aeb978e`) Done — RESULT: 7/7 PASS. 12 board-construction picks written (boardRunId `682c84c6`), 12 with lifecycle rows, 0 shadow_mode violations, 0 duplicate tuples, 2 audit entries. Micro compute upgrade (NANO→Micro) applied to resolve resource exhaustion during proof run. Phase 5 gate CLOSED. Phase 6 opened.

2026-04-09 — **Phase 5 — Governed Write Path + CC Surface (P5-01/P5-02 merged, P5-03 proof in progress).**
UTV2-476 (P5-01: governed candidate-to-pick write path, PR #214, commit `9766ef9`) Done. Introduces `board-pick-writer.ts`: reads latest `syndicate_board` run, calls `processSubmission()` per row with `source='board-construction'`, immediately links `pick_candidates.pick_id` per-row (not deferred), sets `shadow_mode=false` on each successful link. Idempotent: already-linked candidates skipped. Auth-gated `POST /api/board/write-picks` (operator role only — `auth.ts` route registry). Audit record written per run (`board.pick_write.completed`, entity_type `syndicate_board`).
UTV2-477 (P5-02: CC board queue review surface, PR #215, commit `919599a`) Done. Adds `GET /api/operator/board-queue` (operator-web, latest run only — no historical mixing), `BoardQueueRow`/`BoardQueueData` types, `BoardQueueTable` component with Pending/Written badges and `Write N Pending Picks` button, `writeSystemPicks()` Next.js server action (delegates to API, bearer-auth'd, idempotent, revalidates path), Board Queue nav under Decision workspace in `WorkspaceSidebar`. No suppress/reroute implemented — governed write is the only available action (scope discipline enforced).

2026-04-09 — **Phase 4 (Board Construction) closed. Evidence bundle: UTV2-475.**
Phase 4 gate open. UTV2-473 (ranked candidate selection, PR #212, commit `4189f9d`) Done. UTV2-474 (board construction service, PR #213, commit `f1c3acc`) Done. UTV2-475 (Phase 4 evidence bundle, commit `5daaf0b`) Done — 301 board candidates, board size 12, sport cap enforced, pick_id/shadow_mode boundaries verified. Phase 5 gate opened.

2026-04-09 — **Phase 3 (Model Scoring) closed. Evidence bundle: UTV2-471.**
UTV2-470 (model runner wired into live candidate scoring, PR #211, commit `d82c554`) Done. UTV2-472 (participant FK resolution + 196-player alias backfill, PR #210, commit `6f6a2e0`) Done. UTV2-471 evidence bundle (`4b5e4a9`): 301 scored candidates, Phase 4 gate opened.

2026-04-09 — **Phase 2 (Syndicate Machine Foundation) closed. Evidence bundle: UTV2-464.**
Phase 2 closed at `c077ab1`. All migrations live. `market_universe` and `pick_candidates` tables active. Materializer, line movement, board scan complete. UTV2-464 evidence PASS. Phase 3 gate opened. Phase 1 closed earlier at `66c9cc1`.

2026-04-08 — **CC-M5 batch closed (UTV2-445/446/447). Decision stub shells normalized, Intelligence nav unified, Intelligence shared patterns enforced.**
UTV2-446 (Decision stub shells + error boundary, PR #196, commit `4eefd89`) Done. UTV2-447 (Intelligence workspace tab navigation unification, PR #195, commit `838b271`) Done. UTV2-445 (Intelligence shared UI patterns, PR #197, commit `e377ceb`) Done. All T3 bounded UI work. CI green on all 3. Browser/runtime verified. Linear board: no Ready issues remaining. UTV2-431/433/435 blocked (live data gates). Phase 7 deferred (PM approval required).

2026-04-08 — **Green-state recovery sprint. Worker crash loop fixed (UTV2-441). Repo hygiene recovered (UTV2-442). Docs truth-synced (UTV2-443).**
Worker was crashing on transient Supabase network errors (159 restarts since 2026-04-07). Fix deployed (PR #188): transient fetch/5xx errors no longer crash the process. Worker restarted clean (Restarts: 0, Verdict: UP). Repo working tree clean: 4 governed scripts committed, 10 scratch scripts deleted, .gitignore updated. Migration history drift repaired (012–015 applied via Dashboard, not recorded in schema_migrations — repaired via `supabase migration repair`). pg_cron nightly retention scheduled (UTV2-439, migration 016 live). 48/48 migrations local = remote, head `202604080016`. 188/188 tests pass. CC Unification Phase 2 complete (PRs #183–#186: nav shell, module UI, analytics sequence, LLM governance). Linear board: UTV2-415/419 promoted to Ready (spec-only, not blocked). UTV2-441/442/443/439/428/427/426/425 Done.

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

## Closed Milestones

### M13 Items (CLOSED)

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

### Wave 2 Codex Queue

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

## Historical Key Capabilities (as of 2026-04-01)

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
- `GET /api/operator/stats` — capper win rate / ROI / avgClvPct
- `GET /api/operator/leaderboard` — ranked capper leaderboard
- `GET /api/operator/participants` — player/team search
- `GET /api/operator/events` — upcoming events
- `GET /api/operator/recap` — settlement summary via domain
- `GET /api/operator/performance` — comparative performance (Wave 4)
- `GET /api/operator/intelligence` — intelligence layer (Wave 4)

### Command Center (Wave 4)
- Next.js 14 app at `apps/command-center` (port 4300)
- Dashboard, picks-list, review, held, exceptions, performance, intelligence, decisions, interventions, pick trace

### Data ingestion
- `apps/ingestor/` live — SGO feed, Odds API (Pinnacle/DK/FD/BetMGM)
- Player-prop canonicalization, event identity resolution
- 329k provider_offers rows (historical backfill complete)

### Worker runtime
- Worker process activated, supervisor, simulation mode, rollout controls
- Safe activation pipeline: simulate → canary → gradual rollout → full activation

### Discord bot, Alert agent, Smart Form, Settlement recap, Member tier model, Observability
- All operational. See closed milestone records above for detail.

### Cutover readiness
- Production readiness canary plan ratified. G12 gate OPEN (canary not started).
- Sprint A safety fixes all shipped.

---

## Historical Gate Notes (last full run 2026-04-08)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | All suites 0 failures. |
| `pnpm verify` (full chain) | PASS | Exit 0. |
| Playwright e2e | PASS | **188/188** |

---

## Historical Stale Authority Files

| File | Last Accurate | Do Not Use For |
|------|---------------|----------------|
| `docs/06_status/NEXT_UP_EXECUTION_QUEUE.md` | 2026-03-26 | Active lane queue |
| `docs/06_status/system_snapshot.md` | 2026-03-21 | Current state |
| `docs/06_status/status_source_of_truth.md` | 2026-03-21 | Superseded |
| `docs/06_status/current_phase.md` | 2026-03-21 | Superseded |
| `docs/06_status/next_build_order.md` | 2026-03-21 | Superseded |
| `docs/04_roadmap/active_roadmap.md` | 2026-03-21 | Current roadmap |
| `docs/06_status/production_readiness_checklist.md` | 2026-03-26 | Lane state |

---

## Historical Honest Assessment (forensic audit 2026-03-31)

| Layer | Grade | Reality |
|-------|-------|---------|
| **Infrastructure** | 8/10 | Lifecycle FSM, outbox delivery, circuit breakers, atomic claims, rollout controls, simulation mode, writer authority — production-grade. |
| **Intelligence** | 6/10 | Real edge live: model probability vs devigged Pinnacle/consensus/SGO market data. EdgeSource tracked in every promotion snapshot. Multiple odds providers (SGO + Odds API: Pinnacle, DK, FD, MGM). Walk-forward backtesting infrastructure in `clv-weight-tuner.ts` (not yet operationalized). Calibration still dead code. Scoring weights unvalidated against outcomes — infrastructure exists but no scheduled runs. |
| **Product** | 5/10 | Discord delivery works but provides no decision support. No confidence, edge, thesis, or Kelly in pick embeds. Recaps lack sample size context. |

**Launch positioning:** Pick operations + distribution + tracking platform with real market edge computation. Sprint D (Intelligence v1) is complete. Locked roadmap Phases 1–6 closed 2026-04-10. NOT a syndicate-level intelligence system — that requires **Phase 7 (governance-first)**.
