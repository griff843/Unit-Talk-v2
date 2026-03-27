# Program Status

> Canonical high-level status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md`.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Operational work queue (active/ready/blocked/done): `docs/06_status/ISSUE_QUEUE.md`**

## Last Updated

2026-03-27 — M7 CLOSED. UTV2-44 (PR #21) + UTV2-46 (PR #22) merged. No active lanes.

---

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | Run `pnpm test` for current count. Last verified 2026-03-27: 621 tests, 0 failures. |
| Gates | `pnpm verify` exits 0 on current main. |
| Operating Model | Risk-tiered sprints (T1/T2/T3) per `SPRINT_MODEL_v2.md` |
| Milestone | **M7 CLOSED** 2026-03-27 — Discord social surfaces + CLV wiring. M8 not yet planned. |

## Gate Notes (last verified 2026-03-27)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | PASS | |
| `pnpm lint` | PASS | 0 errors. `.next/**` in eslint ignores. Radix UI components exempt from `no-explicit-any`/`no-empty-object-type`. |
| `pnpm type-check` | PASS | 0 errors. |
| `pnpm build` | PASS | Exit 0. |
| `pnpm test` | PASS | 6 bounded groups chained with `&&`. Run `pnpm test` for current count. Last verified 2026-03-27: 621 tests, 0 failures. |
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

**Note:** `apps/smart-form` tests run via `pnpm --filter @unit-talk/smart-form test` only — not in root `pnpm test`.

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

## Next Milestone (M8 — not yet planned)

**Do not open without a ratified M8 contract.**

| Item | Expected Tier | Rationale |
|------|---------------|-----------|
| CLV wiring live proof | T1 verify | Confirm `/stats` and `/leaderboard` avgClvPct non-null in live DB after UTV2-46 |
| Discord CLIENT_ID fix | T3 | `DiscordAPIError[20012]` — CLIENT_ID in `local.env` doesn't match bot token owner; blocks `deploy-commands` |
| Smart Form `confidence` field | T2 | Without it, all Smart Form submissions score 61.5, below best-bets threshold (70) |
| Offer Fetch service wrapper | T2 | Multi-book consensus at submission |
| DeviggingService integration | T2 | Service wrapper around existing pure-computation devig |
| Risk Engine integration | T2 | Bankroll-aware sizing service wrapper |
| Discord `/recap` command | T2 | RecapAgent not implemented; deferred |

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
| Smart Form `confidence` field missing — all submissions score 61.5 | Medium | **Open** — `buildSubmissionPayload()` does not include `confidence`. All Smart Form picks ineligible for best-bets (threshold 70). |
| Board caps (perSlate=5) may re-saturate | Low | **Partially resolved** — lifecycle filter fix (UTV2-38) counts only queued/posted picks. Monitor after next full test run. |
| Historical pre-fix outbox rows noise in operator incident triage | Low | Open |
| API process requires manual restart for new code in dev | Low | Open |
| `system_snapshot.md` stale | Low | Last updated 2026-03-21. Proof IDs still valid as historical record; current-state claims are wrong. Use `PROGRAM_STATUS.md`. |
| `production_readiness_checklist.md` stale | Low | Last updated 2026-03-26. Use `ISSUE_QUEUE.md` for current lane state. |

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
- `/stats @capper` live
- `/leaderboard` live
- `responseVisibility` flag on `CommandHandler` — fail-closed (private unless explicitly `'public'`)
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
