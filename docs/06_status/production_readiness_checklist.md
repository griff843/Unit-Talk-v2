# Production Readiness Checklist

> Living document. Update at every sprint close or whenever a checklist item changes state.
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict for current sprint state.
> Last updated: 2026-03-26 (Discord Bot `/pick` CLOSED — DISCORD_PICK_COMMAND_CLOSED; 719/719 tests; `pnpm verify` exit 0)

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — runtime-enforced, tested, live |
| 🔄 | In progress — active sprint |
| ⬜ | Not started |
| 🔒 | Blocked — contract or dependency missing |
| ❌ | Intentionally deferred |

Tier labels: **T1** = high-risk/proof-required · **T2** = moderate · **T3** = low-risk/pure-compute

---

## Section 0 — Developer Workflow & Tooling

Foundation-level velocity infrastructure. Fix these before opening new feature lanes.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 0.1 | `pnpm verify` exits 0 deterministically | ✅ | — | 719/719, two consecutive runs confirmed |
| 0.2 | Test groups split (≤9 files each) | ✅ | — | 8 groups (incl. test:smart-form), chained with `&&` |
| 0.3 | Artifact drift hook on Write/Edit | ✅ | — | `.claude/hooks/artifact-drift-check.sh` |
| 0.4 | Supabase MCP (read-only) | ✅ | — | Configured in `.claude/settings.json` |
| 0.5 | Linear MCP | ✅ | — | Configured in `.claude/settings.json` |
| 0.6 | Context7 MCP | ✅ | — | Available for library docs |
| 0.7 | Augment Code integration | ✅ | — | MCP-backed context/retrieval layer; T2/T3 implementation support |
| 0.8 | GitHub Actions CI (lint + type-check + build + test on PR) | ✅ | T3 | `.github/workflows/ci.yml` — all branches; excludes `env:check` + `test:db` (live creds) |
| 0.9 | GitHub MCP server | ✅ | T3 | Configured in `.claude/settings.json` — PR management, issue sync from Claude sessions |
| 0.10 | Bash safety guard hook (pre-destructive-git) | ✅ | T3 | `.claude/hooks/bash-safety-guard.sh` — PreToolUse/Bash, exit 2 non-blocking |
| 0.11 | Stop hook — session summary | ✅ | T3 | `.claude/hooks/session-summary.sh` — changed files + test reminder |
| 0.12 | Test-group suggester hook (PostToolUse Edit) | ✅ | T3 | `.claude/hooks/suggest-test-group.sh` — maps file path to `pnpm test:*` group |
| 0.13 | Codex/Claude/Augment lane discipline documented | ✅ | — | `delivery_operating_model.md` — Tool Routing table + lane rules |
| 0.14 | Agent delegation policy active | ✅ | T2 | `docs/05_operations/agent_delegation_policy.md` — Claude/Codex/Augment routing, parallel work rules, capacity handling |

---

## Section 1 — Protocol Foundation

Core pipeline. This is what V2 is built on. All items must stay green.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 1.1 | Submission intake (API) | ✅ | — | `POST /api/submissions` live |
| 1.2 | Pick lifecycle state machine | ✅ | — | `validated → queued → posted → settled → voided` enforced |
| 1.3 | Promotion gate — dual policy | ✅ | — | `best-bets` (≥70) + `trader-insights` (≥80/85/85) |
| 1.4 | Distribution outbox + worker | ✅ | — | Polls, claims, delivers, records receipt |
| 1.5 | Discord delivery — canary | ✅ | — | Channel `1296531122234327100` live |
| 1.6 | Discord delivery — best-bets | ✅ | — | Channel `1288613037539852329` live |
| 1.7 | Discord delivery — trader-insights | ✅ | — | Channel `1356613995175481405` live |
| 1.8 | Settlement write path | ✅ | — | Initial + correction chains + manual review |
| 1.9 | Immutable audit log | ✅ | — | DB-trigger enforced |
| 1.10 | Operator dashboard (read-only) | ✅ | — | Snapshot, pipeline, recap endpoints live |
| 1.10a | `GET /api/operator/picks/:id` — per-pick lifecycle detail | ✅ | — | Lifecycle chain, promo history, outbox, receipts, settlement, audit, submission linkage |
| 1.10b | `GET /api/operator/manual-review` — unresolved manual review queue | ✅ | — | Filtered to picks still in `posted` state |
| 1.10c | `GET /api/operator/submissions/:id` — submission ingestion trace | ✅ | — | Submission row + events + linked pick + derived trace |
| 1.10d | Voided picks counted in pipeline summary | ✅ | — | `counts.voided` + included in `total` |
| 1.10e | Entity health on snapshot + Entity Catalog / Upcoming Events / Last Ingest Cycle HTML sections | ✅ | T2 | **CLOSED** — `entityHealth` (5 count fields), 3 HTML sections. Verdict: OPERATOR_ENTITY_INGEST_HEALTH_CLOSED. |
| 1.10f | `GET /api/operator/participants` — participant search (type/sport/q/limit) | ✅ | T2 | **CLOSED** — player/team search with ilike filter. 586/586 tests. |
| 1.11 | Smart Form intake | ✅ | — | Posts to API; source hardcoded `'smart-form'` |
| 1.12 | In-memory fallback (no-DB mode) | ✅ | — | All tests run without live Supabase |
| 1.13 | Single-writer discipline | ✅ | — | `apps/api` is the only canonical DB writer |

---

## Section 2 — Domain Math Layer

The hardest intellectual work. Already done in V2 — more rigorous than legacy.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 2.1 | Devigging / probability calibration | ✅ | — | `packages/domain` — tested |
| 2.2 | Kelly fraction sizing | ✅ | — | Tested |
| 2.3 | CLV computation logic | ✅ | — | Tested + fed live data + operator surface live — pick 5a36ffbf: clvRaw=0.039736, beatsClosingLine=true; clvSummary + pipeline CLV columns in operator dashboard |
| 2.4 | Edge validation | ✅ | — | Tested |
| 2.5 | Market signals / book dispersion | ✅ | — | Tested |
| 2.6 | Scoring (MLB/NBA/NFL/NHL) | ✅ | — | Tested |
| 2.7 | Band assignment + downgrade logic | ✅ | — | Tested |
| 2.8 | Strategy evaluation + comparison | ✅ | — | Tested |
| 2.9 | Risk engine | ✅ | — | Tested |
| 2.10 | System health metrics | ✅ | — | Tested |
| 2.11 | Rollup computations | ✅ | — | Tested |
| 2.12 | Verification control plane | ✅ | — | Scenario registry, run history, archive |

---

## Section 3 — Track A: Discord Bot & User Interaction Surface

Primary interface for cappers and members. Currently a stub.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 3.1 | Smart Form V1 — operator submission surface | ✅ | T1 | **CLOSED** — `capperConviction` (1–10) → `trust = conviction × 10`. Root 548/548, Smart Form package 112/112. Verdict: SMART_FORM_V1_CLOSED |
| 3.2 | Discord bot foundation (connection, command router) | ✅ | T2 | **CLOSED** — connection lifecycle, command registry, interaction router, role guard, API client, deploy-commands. 581/581 tests. Verdict: DISCORD_BOT_FOUNDATION_CLOSED. |
| 3.3 | `/pick` — submit a pick via bot command | ✅ | T2 | **CLOSED** — guild-scoped slash command, capper role gate via `DISCORD_CAPPER_ROLE_ID`, canonical `POST /api/submissions` handoff only, validation + API failure handling covered in tests. Root verify 719/719. Verdict: DISCORD_PICK_COMMAND_CLOSED. |
| 3.4 | `/stats` — capper performance lookup | ⬜ | T2 | Requires domain rollup consumer |
| 3.5 | `/recap` — daily/weekly recap command | ⬜ | T2 | Requires RecapAgent (Section 5) |
| 3.6 | `/portfolio` — personal pick history | ⬜ | T2 | Requires user/capper association |
| 3.7 | `/pick-result` — manual result entry | ⬜ | T2 | Bridge until auto-grading (Section 4) |
| 3.8 | `/top-plays` — leaderboard surface | ⬜ | T2 | Requires AnalyticsAgent (Section 5) |
| 3.9 | Capper onboarding flow | ⬜ | T1 | Tier system + role assignment — needs contract |
| 3.10 | Trial management (`/trial-status`, `/upgrade`) | ⬜ | T2 | Depends on 3.9 |
| 3.11 | Capper tier system (Free/VIP/VIP+/Pro/Elite) | ⬜ | T1 | Core user model — needs contract |
| 3.12 | Thread management (game threads) | 🔒 | T1 | Blocked — thread routing not implemented; needs contract |
| 3.13 | DM notification system | 🔒 | T1 | Blocked — no DM delivery mechanism; needs contract |
| 3.14 | Alert slash commands (`/alerts-setup`, `/heat-signal`) | 🔒 | T2 | Blocked on AlertAgent (Section 4) |
| 3.15 | `/ask-ai` — LLM pick analysis command | 🔒 | T2 | Blocked on OpenAI integration (Section 5) |
| 3.16 | Discord bot — all 30+ legacy commands restored | ⬜ | T2 | Full parity milestone |

---

## Section 4 — Track B: Live Data & Market Intelligence

The single biggest capability gap for syndicate-level operation. Everything downstream depends on this.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 4.1 | SGO ingestion — fetch → normalize → persist to `provider_offers` | ✅ | T1 | **CLOSED** — `apps/ingestor` live, 618 rows inserted (NBA proof run 2026-03-26), idempotency confirmed. OddsAPI slice 2 deferred. |
| 4.2 | Canonical ingestion service (`apps/ingestor`) | ✅ | T1 | **CLOSED** — standalone app live; SGO fetch → normalize → persist pipeline proven end-to-end |
| 4.3a | Feed entity resolution — events, participants, event_participants | ✅ | T1 | **CLOSED** — resolvedEventsCount=10, resolvedParticipantsCount=65, runId=cf46240d. 10 events, 46 players, 66 event_participant links (home/away/competitor). Idempotency confirmed. Sentinel fix applied. 581/581 tests. Verdict: FEED_ENTITY_RESOLUTION_CLOSED. |
| 4.3 | Automated pick grading (event-driven result lookup) | 🔄 | T1 | **CONTRACT RATIFIED** — `T1_AUTOMATED_GRADING_CONTRACT.md` (2026-03-26). Migration 012 (`game_results` table). `grading-service.ts` + `recordGradedSettlement()` internal path. Opens after Discord `/pick` closes. |
| 4.4 | Auto-settlement trigger (grading → settlement) | ⬜ | T1 | Covered by 4.3 — grading IS settlement in this architecture |
| 4.5 | CLV tracking automation (post-close line lookup) | ✅ | T1 | **CLOSED** — `T1_CLV_CLOSING_LINE_WIRING_CONTRACT.md`. Migration 011 applied (Remote 202603200011 confirmed). findClosingLine() + settlement wiring + operator display live. Live proof: pick 5a36ffbf, clvRaw=0.039736, beatsClosingLine=true, providerKey=sgo. starts_at confirmed (ingest run 557bc4f2). 708/708 tests. Verdict: CLV_CLOSING_LINE_WIRING_CLOSED. |
| 4.6 | Line movement detection (AlertAgent) | ⬜ | T2 | Depends on 4.1; detect significant line shifts |
| 4.7 | Hedge detection | ⬜ | T2 | Depends on 4.6 |
| 4.8 | Multi-book consensus signal | ⬜ | T2 | Odds provider 2 (Optimal/Elite Dual-API) |
| 4.9 | Odds provider 2 integrated | ⬜ | T2 | Depends on 4.2 |
| 4.10 | Odds provider 3 integrated | ⬜ | T3 | Full multi-book parity with legacy |
| 4.11 | API quota tracking / credit logging | ⬜ | T3 | Rate limit coordination across providers |
| 4.12 | Circuit breaker (odds API) | ⬜ | T3 | Fault isolation for external data |

---

## Section 5 — Track C: Workflow Orchestration & Analytics

Operational scaling. Required once pipeline complexity exceeds synchronous/manual capacity.

| # | Item | Status | Tier | Notes |
|---|------|--------|------|-------|
| 5.1 | RecapAgent — daily/weekly Discord posts | ⬜ | T2 | Recap endpoint exists; agent + scheduler needed |
| 5.2 | AnalyticsAgent — metrics aggregation | ⬜ | T2 | Leaderboards, pick performance by tier |
| 5.3 | Player enrichment agent | ⬜ | T2 | Player stats, historical performance |
| 5.4 | Temporal integration (workflow engine) | ❌ | T1 | **DEFERRED TO SYNDICATE GATE** — Outbox polling pattern + cron jobs are sufficient for Elite Production. Add Temporal only when pipeline has multi-step compensating workflows at high volume. |
| 5.5 | Recap workflow (cron-based) | ⬜ | T2 | Simple scheduled job; no Temporal dependency |
| 5.6 | Grading workflow (triggered on ingest) | ⬜ | T2 | Triggered by ingest cycle; no Temporal dependency |
| 5.7 | Feed backfill workflow | ⬜ | T2 | Historical data catch-up via bounded script |
| 5.8 | Analytics dashboard (Command Center rebuild) | ⬜ | T2 | Operator controls, agent health, pick performance |
| 5.9 | Member-facing analytics dashboard | ⬜ | T2 | Portfolio tracking, leaderboards |
| 5.10 | Redis caching layer | ❌ | T3 | **DEFERRED TO SYNDICATE GATE** — No measurable latency/throughput bottleneck at current scale. Supabase + sequential worker is sufficient. Add Redis only when a specific bottleneck is measured. |
| 5.11 | OpenAI / LLM pick analysis integration | ⬜ | T2 | Smart pick commentary; needs circuit breaker |
| 5.12 | Notion sync (checkpoint/decision log) | ⬜ | T3 | Operational continuity |
| 5.13 | Shadow mode testing framework | ⬜ | T3 | Parallel run without live impact |
| 5.14 | Golden test suite (regression detection) | ⬜ | T3 | Historical validation baseline |

---

## Section 6 — Discord Channel Activation

| # | Channel | Status | Dependency |
|---|---------|--------|------------|
| 6.1 | `discord:canary` | ✅ LIVE | — |
| 6.2 | `discord:best-bets` | ✅ LIVE | — |
| 6.3 | `discord:trader-insights` | ✅ LIVE | — |
| 6.4 | `discord:exclusive-insights` | 🔒 Blocked | Needs contract |
| 6.5 | `discord:game-threads` | 🔒 Blocked | Thread routing not implemented |
| 6.6 | `discord:strategy-room` | 🔒 Blocked | DM routing not implemented |
| 6.7 | `discord:free-daily-picks` | 🔒 Blocked | Not ratified in V2 target map |
| 6.8 | `discord:strategy-lab` | 🔒 Blocked | Not in V2 target map |
| 6.9 | `discord:recaps` | 🔒 Blocked | Depends on RecapAgent (5.1) |

---

## Section 7 — Elite Production Gate

Full feature parity with the legacy Unit Talk production repo. All items in Sections 1–6 must be ✅.

| # | Gate Criterion | Status |
|---|----------------|--------|
| 7.1 | All 6 Discord channels live | ⬜ |
| 7.2 | Full Discord bot command suite (30+ commands) | ⬜ |
| 7.3 | Capper tier system live (Free → Elite) | ⬜ |
| 7.4 | Live odds ingestion from ≥2 providers | ⬜ |
| 7.5 | Automated grading + settlement | ⬜ |
| 7.6 | CLV tracking live and recorded per pick | ✅ |
| 7.7 | Daily/weekly recap automation | ⬜ |
| 7.8 | Analytics dashboard live | ⬜ |
| 7.9 | Alert system live (line movement + hedge) | ⬜ |
| 7.10 | Temporal workflows active for pipeline orchestration | ❌ | Deferred to Syndicate Gate — cron-based workflows sufficient for Elite Production |
| 7.11 | All domain math consumers wired to live data | ⬜ |
| 7.12 | `pnpm verify` green with ≥800 tests | ⬜ |

**Estimated sprint distance: 12–16 sprints (T1/T2 mix) at current velocity.**
With Codex + Augment CLI running parallel T2 implementation lanes alongside Claude governance: **8–11 sprints**.
Note: Redis and Temporal removed from this gate — deferred to Section 8. Cron-based workflows replace Temporal dependency for recap, grading, and feed backfill.

---

## Section 8 — Syndicate Gate

Coordinated, data-driven, multi-book operation with automated sizing and real-time market intelligence.
Requires Elite Production Gate (Section 7) to be fully closed first.

| # | Gate Criterion | Status |
|---|----------------|--------|
| 8.1 | ≥3 odds providers integrated with real-time consensus | ⬜ |
| 8.2 | Live CLV optimization loop (alert on favorable close vs open) | ⬜ |
| 8.3 | Kelly-based sizing signals surfaced per pick in real-time | ⬜ |
| 8.4 | Hedge detection + routing to eligible members | ⬜ |
| 8.5 | Coordinated line movement alerts (<60s latency) | ⬜ |
| 8.6 | Multi-book consensus disagrees → elevated edge signal | ⬜ |
| 8.7 | Risk engine active (bankroll-aware position sizing) | ⬜ |
| 8.8 | Automated devig + consensus probability per pick at submission | ⬜ |
| 8.9 | Historical CLV performance by capper tracked and surfaced | ⬜ |
| 8.10 | Shadow mode validation framework live | ⬜ |
| 8.11 | Golden test suite covering all scoring paths | ⬜ |
| 8.12 | All pipeline stages Temporal-orchestrated with deterministic replay | ⬜ |

**Estimated sprint distance from Elite Production: 30–40 additional sprints.**
**Note:** The domain math required for syndicate operation (Kelly, CLV, devig, edge, calibration) is already done in V2 and is more rigorous than legacy. The remaining gap is data plumbing and automation — not new intellectual work.

---

## Update Rule

- Update status symbols at every sprint close
- Update sprint distance estimates at Section 7 and 8 when velocity data improves
- Do not add new checklist items without a clear purpose (authority / contract / activation / proof)
- This file is a status tracker — it does not override `PROGRAM_STATUS.md` or any contract doc
