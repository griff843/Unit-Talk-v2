# Program Status

> Canonical active status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md` for active maintenance.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> Runtime evidence: `docs/06_status/system_snapshot.md`

## Last Updated

2026-03-26 — UTV2-34 IN_REVIEW (deploy-commands blocked: `DISCORD_CLIENT_ID`, `DISCORD_CAPPER_ROLE_ID`, `UNIT_TALK_API_URL` missing from `local.env`). UTV2-28 CLOSED (live grading proof WIN). UTV2-32 /stats contract RATIFIED. UTV2-35 market key contract RATIFIED. All Claude lane contracts complete. Tests: 740/740.

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | 740/740 passing — deterministic across consecutive runs |
| Gates | All gates PASS. `pnpm verify` exits 0. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) — see `SPRINT_MODEL_v2.md` |
| Active Sprint | None — UTV2-28 CLOSED. Next: READY queue (UTV2-30, UTV2-31, UTV2-33, UTV2-36) |
| Active Contract | — (UTV2-28 contract closed) |
| Parallel Lanes | Augment: UTV2-34 IN_REVIEW (blocked — missing env vars), UTV2-37 READY |
| Queue | `docs/06_status/ISSUE_QUEUE.md` — Linear: UTV2-40–49 |

## Gate Notes (2026-03-22)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | Environment files pass validation. |
| `pnpm lint` | PASS | 0 errors. `.next/**` added to eslint ignores. Ported Radix UI components in `apps/smart-form/components/ui/**` exempt from `no-explicit-any` / `no-empty-object-type`. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | 728/728. 8 bounded groups, chained with `&&`. Deterministic on Windows. |
| `pnpm verify` (full chain) | PASS | Exit 0 on two consecutive runs without memory reset. |

### Runner Architecture (post-hardening)

The root `test` script is split into 8 named groups:

| Script | Files | Surface |
|--------|-------|---------|
| `pnpm test:apps` | 7 | apps/api + apps/worker + apps/operator-web |
| `pnpm test:ingestor` | — | apps/ingestor |
| `pnpm test:verification` | 4 | packages/verification |
| `pnpm test:domain-probability` | 6 | domain/probability + domain/outcomes-core |
| `pnpm test:domain-features` | 9 | domain/features + domain/models |
| `pnpm test:domain-signals` | 6 | domain/signals + bands + calibration + scoring |
| `pnpm test:domain-analytics` | 8 | domain/outcomes + market + eval + edge + rollups + system-health + risk + strategy |
| `pnpm test:smart-form` | 20 | apps/smart-form — form schema, utils, UI components |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | 31 tests | foundation + `/pick` command registration, validation, routing, and API handoff |

`pnpm test` chains all 8 with `&&` (fail-closed). Each group is independently invocable for targeted debugging.

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
| T3 Deploy Commands Verify (UTV2-34) | — | T3 | **IN_REVIEW — BLOCKED** | `deploy-commands` verification run. `loadBotConfig()` requires 5 vars; 3 missing from `local.env`: `DISCORD_CLIENT_ID`, `DISCORD_CAPPER_ROLE_ID`, `UNIT_TALK_API_URL`. Deployment NOT executed per AC item 4. Blocker documented. Resolution: add the three vars to `local.env` and re-run. Branch: `augment/UTV2-34-deploy-commands-verify`. |
| T2 Market Key Normalization Contract (UTV2-35) | — | DOCS | **CLOSED** | `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md` authored and ratified. 16-entry translation table (NBA + MLB). Normalization at submission time via `normalizeMarketKey()`. Unknown markets pass through. UTV2-33 now READY. Verdict: MARKET_KEY_CONTRACT_RATIFIED. |
| T2 Discord /stats Contract (UTV2-32) | — | DOCS | **CLOSED** | `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` authored and ratified. Derives from DISCORD_STATS_COMMAND_SPEC.md. Defines: GET /api/operator/stats shape, capper identity via submitted_by, embed format, sample size guards, 10 AC, proof requirements, 8 net-new tests required. UTV2-31 now READY. Verdict: STATS_CONTRACT_RATIFIED. |
| T1 Automated Grading (UTV2-28) | — | T1 | **CLOSED** | `game_results` table (migration 012) + `GradeResultRepository` + `runGradingPass()` + `POST /api/grading/run` + CLV enrichment. 11 net-new tests (740 total). Migration 013 applied (settlement source check extended to include 'grading'). Live proof: pick `41c8e72a` graded WIN → `settlement_records` `id=1c9d8581`, `source=grading`, `result=win`. Idempotency confirmed (second pass attempted=4, graded=0). UTV2-30, UTV2-35 promoted to READY. Verdict: T1_AUTOMATED_GRADING_CLOSED. |
| Queue + Orchestration System | — | DOCS | **CLOSED** | Queue-driven model live. `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` authored — state machine, branch/PR rules, Claude/Codex/Augment operating models, fail-closed rules, DoD. `docs/06_status/ISSUE_QUEUE.md` — 10 issues structured. 6 Linear labels created (tier:T1/T2/T3, lane:claude/codex/augment). 10 Linear issues created (UTV2-40–49). `.github/pull_request_template.md` upgraded. `docs/templates/issue-template.md` created. SGO MLB live proof ratified T2 contract — results structure corrected (nested object not flat keys; boolean status flags not statusId). Discord `/stats` spec authored. 3 warm lanes now assigned. Verdict: QUEUE_SYSTEM_LIVE. |
| T3 Operator CLV Surface | — | T3 | **CLOSED** | `apps/operator-web/src/server.ts` only. `OperatorClvSummary` (picksWithClv, beatingRate, averageClvPct). `clvSummary` on `OperatorSnapshot`. `PickPipelineRow` extended with closingOdds/clvPct/beatsClosingLine. HTML: Closing Line Value block in Settlement Recap + CLV columns in Picks Pipeline table. 46/46 operator tests (was 34). Total: 719 → 728. Verdict: OPERATOR_CLV_SURFACE_CLOSED. |
| T2 Discord Bot `/pick` Command | — | T2 | **CLOSED** | First business command added to `apps/discord-bot` only. Guild-scoped `/pick` registration now works in both tsx source runs and built `.js` runs. Capper-only role gate via `DISCORD_CAPPER_ROLE_ID`. Slash-command parsing validates sport, market type, event, selection, odds, units, conviction, optional line, and optional sportsbook. Command submits through `POST /api/submissions` only and maps conviction to `metadata.promotionScores.trust`. Added success/failure handling for API validation and API unavailability. Root verify green at 719/719. Verdict: DISCORD_PICK_COMMAND_CLOSED. |
| T1 CLV Closing Line Lookup & Settlement Wiring | — | T1 | **CLOSED** | Migration 011 applied — Remote 202603200011 confirmed (`supabase db push --linked` + `migration list --linked` both show in sync; dry-run: "Remote database is up to date"). findClosingLine() + updatePayload() on repositories. clv-service.ts: pick→event resolution, devig, CLV computation. Settlement wiring live. Operator PickDetailView includes CLV. Entity resolver stores starts_at. 708/708 tests. Live proof: pick 5a36ffbf, settlement 62a37a4f, payload.clv={clvRaw:0.039736, beatsClosingLine:true, providerKey:sgo}. starts_at confirmed (ingest run 557bc4f2, 10 events with ISO timestamps). Operator route HTTP 200 returns full clv field. Verdict: CLV_CLOSING_LINE_WIRING_CLOSED. |
| T3 Smart Form Tests Wired Into Root Verify | — | T3 | **CLOSED** | `test:smart-form` group added to root `package.json` `test` script. 112/112 Smart Form tests now run in `pnpm verify` chain. Total root test count: 596 → 708. Verdict: SMART_FORM_TESTS_WIRED. |
| T2 Operator Entity & Ingest Health Surface | — | T2 | **CLOSED** | `entityHealth` on snapshot (5 count fields). `GET /api/operator/participants` with type/sport/q/limit filters. HTML: Entity Catalog card, Upcoming Events table, Last Ingest Cycle section. `apps/operator-web` only. Read-only. 586/586 tests. Verdict: OPERATOR_ENTITY_INGEST_HEALTH_CLOSED. |
| T2 Discord Bot Foundation | — | T2 | **CLOSED** | Connection lifecycle, command registry, interaction router, role guard, API client boundary, deploy-commands script. `apps/discord-bot` only. No DB access. Gate recovery applied during Feed Entity Resolution closeout (4 template literal fixes + 3 BOM removals). 581/581 tests. Verdict: DISCORD_BOT_FOUNDATION_CLOSED. |
| T1 Feed Entity Resolution — Events & Participants Foundation | — | T1 | **CLOSED** | Migration 010 applied (events_external_id_idx, participants_external_id_idx). entity-resolver.ts live. NBA ingest: resolvedEventsCount=10, resolvedParticipantsCount=65, runId=cf46240d. event_participants joined (10 home + 10 away + 46 competitor). Idempotency confirmed (second cycle no new rows). GET /api/operator/events live. 124 team rows preserved. Sentinel fix: bogus "home"/"away" player rows filtered. Three contract amendments during lane: role='player'→'competitor' (§6.4), sport_id uppercase (§7.1), team resolution deferred (§6.3). 581/581 tests. Verdict: FEED_ENTITY_RESOLUTION_CLOSED. |
| T1 Smart Form V1 — Capper Conviction Input | — | T1 | **CLOSED** | `capperConviction` (1–10) added to BetForm, schema, payload mapping (trust = conviction × 10). Root verify 548/548. Smart Form package 112/112 (≥50 net-new tests). AC-10 amended during close — Smart Form tests are package-local, not in root verify chain. Verdict: SMART_FORM_V1_CLOSED. |
| T1 Provider Ingestion — SGO Primary | — | T1 | **CLOSED** | Migration 009 applied. `provider_offers` live. `NormalizedProviderOffer`, `ProviderOfferRepository`, `apps/ingestor` complete. `pnpm supabase:types` cross-platform script written (scripts/generate-types.mjs). Live proof: NBA ingest cycle `status=succeeded`, `insertedCount=618`, `runId=156fccbc-b7fa-4ca3-b82c-39f2dcd2cda6`. Idempotency confirmed (second cycle `insertedCount=16` new, `updatedCount=617`). Type regen complete — `ProviderOfferRow` is now generated. Three normalizer bugs fixed: odds field names (`bookOdds`/`fairOdds`), batch query chunking (100-key limit), idempotency key includes participant ID. 548/548 tests. Verdict: PROVIDER_INGESTION_SLICE_1_CLOSED. |
| Command Center Lifecycle Visibility | — | T2 | **CLOSED** | Three new operator routes live: `GET /api/operator/picks/:id` (full lifecycle chain, promo history, outbox, receipts, settlements, audit, submission), `GET /api/operator/manual-review` (unresolved posted picks), `GET /api/operator/submissions/:id` (ingestion trace). Voided picks counted in pipeline summary. Codex implementation independently verified APPROVE — 32 checks CORRECT, 0 mismatch. 542/542 tests. Verdict: LIFECYCLE_VISIBILITY_CLOSED. |
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

## Current Milestone

**No active T1 sprint.** UTV2-28 closed. Four READY issues in queue.

READY now (see `docs/06_status/ISSUE_QUEUE.md`):
- `lane:codex` — UTV2-30 (T2 SGO Results Ingest), UTV2-31 (T2 /stats), UTV2-33 (T2 market key), UTV2-36 (T3 Queue Tooling)
- `lane:claude` — all contracts complete; no READY claude items
- `lane:augment` — UTV2-34 (T3 deploy-commands — IN_REVIEW, blocked by missing env vars), UTV2-37 (T3 seed proof — READY)

**Next T1 candidate:** None queued. UTV2-30 (T2 SGO Results Ingest) is the highest-priority Codex item.
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
| Smart Form V1 missing `confidence` field — all submissions score 61.5, below promotion threshold 70 | Medium | **PARTIALLY RESOLVED (Run 001/002, 2026-03-24)** — Smart Form picks now bypass the confidence floor gate and are evaluated on their score (61.5 < 70 → suppressed). They correctly land in the manual/capper lane. Promotion-eligibility requires scoring rebuild. |
| Board caps (perSlate=5) saturated by accumulated test-run picks | Medium | **RESOLVED (Run 003, 2026-03-24)** — `getPromotionBoardState` now filters to `status IN ('validated', 'queued', 'posted')`. Settled/voided picks no longer count toward caps. Historical test picks no longer pollute board capacity. |
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
| Governed skill pack | `.claude/skills/README.md` |

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
