# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md`.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Operational work queue (active/ready/blocked/done): `docs/06_status/ISSUE_QUEUE.md`**

## Last Updated

2026-03-29 — Wave 1 Codex queue DONE (PRs #64–#67 merged). 773/773 tests. Wave 1+2 Claude queues complete. Wave 2 Codex queue fully unblocked (14 items at Ready). Drift audit complete (PR #68 merged): orphan docs classified, 14 stale files deleted, authority map updated.

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | **773/773 pass** — confirmed 2026-03-29 at main `ab37a8d` (Wave 1 PRs #64–#67 + PR #68 merged). |
| Gates | `pnpm verify` exits 0. Confirmed 2026-03-29 at `ab37a8d`. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) per `SPRINT_MODEL_v2.md` |
| Milestone | **M13 ACTIVE** — Wave 1 DONE. Wave 2 Codex queue unblocked (14 items Ready). UTV2-87 (exclusive-insights) and UTV2-69 (hedge detection) READY. M12 CLOSED 2026-03-28. |

## Gate Notes (last verified 2026-03-28)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | **773/773** — confirmed 2026-03-29 at main `ab37a8d` (Wave 1 PRs #64–#67 + PR #68). |
| `pnpm verify` (full chain) | PASS | Exit 0 confirmed 2026-03-29 at `ab37a8d`. |

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
| `discord:exclusive-insights` | Blocked | Contract ratified (UTV2-87 READY). Not yet implemented. |
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
| UTV2-150 | Upgrade/trial audit trail | T2 | UTV2-149 impl |
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
| Discord CLIENT_ID mismatch — `deploy-commands` may fail | Low | **CLOSED** — UTV2-59 verified 3 commands, UTV2-65 confirmed 5 commands (post /help + /recap). Guild deploy current. |
| Smart Form `confidence` field missing | Resolved | **CLOSED** — UTV2-49 merged. `confidence = capperConviction / 10` wired. Score avg lifted ~20pts. |
| Board caps (perSlate=5) may re-saturate | Low | **Partially resolved** — lifecycle filter fix (UTV2-38) counts only queued/posted picks. Monitor after next full test run. |
| Historical pre-fix outbox rows noise in operator incident triage | Low | Open |
| API process requires manual restart for new code in dev | Low | Open |
| `system_snapshot.md` stale | Low | Last updated 2026-03-21. Proof IDs still valid as historical record; current-state claims are wrong. Use `PROGRAM_STATUS.md`. |
| `production_readiness_checklist.md` stale | Low | Last updated 2026-03-26. Use `ISSUE_QUEUE.md` for current lane state. |

---

## Key Capabilities (current as of 2026-03-28, M13 ACTIVE)

### Submission and lifecycle
- Canonical submission intake live (API + Smart Form)
- Lifecycle transitions enforced (single-writer discipline)
- Market key normalization at submission time (`normalizeMarketKey()`)
- Conviction field → trust score in `metadata.promotionScores`
- Domain analysis at submission time: implied probability, edge, devig (`metadata.deviggingResult`), Kelly sizing (`metadata.kellySizing`) — all fail-closed (UTV2-64, UTV2-67)
- `findLatestMatchingOffer()` sorts by `snapshot_at` DESC — always uses most recent offer (UTV2-67)

### Promotion and delivery
- Promotion evaluation: best-bets policy (min score 70) + trader-insights policy (min score 80)
- Promotion scoring consumes domain analysis for edge, trust, and readiness
- Distribution outbox, worker delivery, receipts, and audit logs live
- 3 live Discord targets: canary, best-bets, trader-insights
- Dead-letter promotion: `attempt_count >= 3` consecutive failures → `dead_letter` status via `markDeadLetter()` (UTV2-62)
- Dead-letter visible in operator snapshot: `counts.deadLetterOutbox`; distribution health degrades when > 0 (UTV2-63)

### Grading and settlement
- `POST /api/grading/run` — automated grading against `game_results`; idempotent
- Settlement write path live: initial + correction chains + manual review
- Downstream settlement truth computed (effective settlement + loss attribution)
- CLV wired: `computeAndAttachCLV()` called at graded settlement; `clvRaw`/`clvPercent`/`beatsClosingLine` written as top-level payload keys (UTV2-46 CLOSED)

### Operator surface
- `GET /api/operator/snapshot` — health, outbox, runs, settlements, entity health
- `GET /api/operator/stats` — capper win rate / ROI / avgClvPct (populates for picks with closing lines)
- `GET /api/operator/leaderboard` — ranked capper leaderboard; avgClvPct populates for picks with closing lines
- `GET /api/operator/participants` — player/team search
- `GET /api/operator/events` — upcoming events
- `GET /api/operator/recap` — settlement summary via domain

### Data ingestion
- `apps/ingestor/` live — populates `provider_offers` and `game_results` from SGO feed
- Entity resolution: events, participants, event_participants resolved from ingestor

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

### Worker runtime
- Worker process activated: `UNIT_TALK_WORKER_AUTORUN=true`, healthy = outbox draining, receipts written, no dead-letter (UTV2-107 PR #44)
- Worker runtime visibility in operator snapshot: `workerRuntime` health signal, last-run summary, outbox drain rate (UTV2-109 PR #45)

### Settlement recap
- `postSettlementRecapIfPossible()` in `grading-service.ts` — fires after each newly graded pick (UTV2-57)
- Posts embed to pick's original Discord delivery channel; channel resolved from `distribution_receipts` → outbox target → `UNIT_TALK_DISCORD_TARGET_MAP`
- No-ops if `DISCORD_BOT_TOKEN` absent or no delivery receipt found

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
| `docs/06_status/production_readiness_checklist.md` | 2026-03-26 | Lane state (use `ISSUE_QUEUE.md`) |

---

## Authority References

| Purpose | File |
|---------|------|
| **Operational work queue** | `docs/06_status/ISSUE_QUEUE.md` |
| **Active program status** | this file |
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Proof template (T1) | `docs/06_status/PROOF_TEMPLATE.md` |
| Rollback template (T1) | `docs/06_status/ROLLBACK_TEMPLATE.md` |
| /leaderboard contract | `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` |
| CLV wiring contract | `docs/05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` |
| Discord routing | `docs/05_operations/discord_routing.md` |
| Migration ledger | `docs/05_operations/migration_ledger.md` |

---

## Update Rule

Update at **T1/T2 sprint close only**. Update: milestone summary, key capabilities, open risks.

**T3 sprints:** update `ISSUE_QUEUE.md` (mark DONE) only. No `PROGRAM_STATUS.md` update required.

Active lane state lives in `ISSUE_QUEUE.md`. Do not duplicate it here.
