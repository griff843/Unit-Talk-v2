# Platform Surfaces Authority

## Metadata

| Field | Value |
|-------|-------|
| Status | Ratified |
| Ratified | 2026-03-29 |
| Issue | UTV2-159 |
| Supersedes | `docs/03_product/program_surfaces.md` |
| Last updated | 2026-03-31 |

Unit Talk is a full platform for pick submission, evaluation, distribution, and settlement. Discord is the primary delivery surface — not the product definition. The platform drives what Discord carries, not the other way around.

This document is the authoritative registry of V2 platform surfaces. It describes every surface, its role, its current live state, and its access model.

**Rule:** A surface is not a surface until it appears here and in `docs/05_operations/docs_authority_map.md`. Surfaces not listed here are not recognized for routing, promotion, or governance purposes.

---

## Surface Registry

### API — Canonical Write Authority

| Field | Value |
|-------|-------|
| App | `apps/api` |
| State | **LIVE** |
| Role | Single canonical writer to the database |

The API is the only surface authorized to write to the database. All submission intake, lifecycle transitions, promotion evaluation, settlement writes, and audit log entries flow through it. No other surface performs writes.

Key endpoints:
- `POST /api/submissions` — canonical pick intake
- `POST /api/picks/:id/settle` — settlement write path
- `POST /api/grading/run` — automated grading trigger
- `GET /health` — component health

---

### Worker — Async Delivery

| Field | Value |
|-------|-------|
| App | `apps/worker` |
| State | **LIVE** (`UNIT_TALK_WORKER_AUTORUN=true`) |
| Role | Async outbox polling and Discord delivery |

The Worker polls `distribution_outbox`, claims rows, and delivers embeds to Discord via the configured delivery adapter. It writes distribution receipts and transitions pick lifecycle on success. Dead-letter handling: `attempt_count ≥ 3` consecutive failures → `dead_letter` status.

The Worker does not write picks or settlement data. It is a delivery executor only.

---

### Command Center — Operator Intelligence Dashboard (Data Backend)

| Field | Value |
|-------|-------|
| App | `apps/operator-web` |
| State | **LIVE** |
| Role | Internal read-only data backend for Command Center |
| Access | Operator / Admin only |

Read-only. No write surfaces. Provides real-time operational health, outbox state, pick pipeline status, and settlement summary. All endpoints are consumed by the Command Center UI (`apps/command-center`).

Key endpoints:
- `GET /` — operator HTML dashboard
- `GET /health` — component health signals
- `GET /api/operator/snapshot` — full `OperatorSnapshot` (filterable)
- `GET /api/operator/picks-pipeline` — picks pipeline summary
- `GET /api/operator/stats` — capper win rate / ROI / avgClvPct
- `GET /api/operator/leaderboard` — ranked capper leaderboard
- `GET /api/operator/participants` — player/team search
- `GET /api/operator/events` — upcoming events
- `GET /api/operator/recap` — settlement summary via domain
- `GET /api/operator/performance` — comparative performance (time windows, source/sport/decision splits, CLV%, insights)
- `GET /api/operator/intelligence` — intelligence layer (recent form, score bands, decision quality, feedback loop, warnings)
- `GET /api/operator/exception-queues` — exception queue counts and rows
- `GET /api/operator/review-history` — review decision history
- `GET /api/operator/review-queue` — picks pending review
- `GET /api/operator/held-queue` — held picks
- `GET /api/operator/pick-search` — pick search with filters
- `GET /api/operator/picks/:id` — full pick detail (8-section lifecycle trace)

---

### Command Center — Operator Intelligence Dashboard

| Field | Value |
|-------|-------|
| App | `apps/command-center` |
| State | **LIVE** |
| Role | Operator intelligence, decision-quality analysis, and pick lifecycle management |
| Access | Operator / Admin only |
| Port | 4300 |

Next.js 14 application that reads from operator-web and writes through the API. No direct DB access. Provides operator-grade intelligence surfaces for evaluating edge, decision quality, and performance trends.

Pages:
- `/` — dashboard with health signals, exceptions, stats summary, pick lifecycle table
- `/picks-list` — filterable pick search with pagination
- `/review` — review queue (approve/deny/hold decisions with reason)
- `/held` — held picks queue with return/resolve actions
- `/exceptions` — 5 exception categories with intervention actions
- `/performance` — comparative performance: capper vs system, decision outcomes, by sport/source, CLV%, insights, leaderboard
- `/intelligence` — score quality (band segmentation, correlation), decision quality (approved vs denied accuracy), recent form (last 5/10/20), feedback loop
- `/decisions` — decision audit with filter tabs
- `/interventions` — intervention audit log
- `/picks/[id]` — 8-section pick lifecycle trace with settlement/correction forms

188 Playwright e2e tests verify all surfaces.

---

### Smart Form — Pick Intake

| Field | Value |
|-------|-------|
| App | `apps/smart-form` |
| State | **LIVE** |
| Role | Browser-based pick submission surface for cappers |
| Access | Capper (any user with the form URL) |

Browser intake form. Posts to `apps/api` via fetch. Source is hardcoded to `'smart-form'` regardless of form input. Body size capped at 64 KB. Includes participant autocomplete (debounced) and conviction field 1–10.

Cappers are both internal operators of the platform machine and customer-facing talent and brands within the product. The Smart Form is their primary submission surface — the human-operated counterpart to the API's programmatic intake.

---

### Discord Bot — Commands and Member Interaction

| Field | Value |
|-------|-------|
| App | `apps/discord-bot` |
| State | **LIVE** (bot: `Unit Talk#9476`) |
| Role | Discord-native member and capper interaction surface |
| Guild | `1284478946171293736` |

The Discord bot provides slash commands for member self-service and capper interaction. It reads from the API; it does not write to the database directly.

Commands: see `docs/03_product/DISCORD_COMMAND_CATALOG.md`.

---

### Ingestor — Provider Data Feed

| Field | Value |
|-------|-------|
| App | `apps/ingestor` |
| State | **LIVE** |
| Role | SGO feed ingest — populates `provider_offers` and `game_results` |
| Access | Internal (cron-driven) |

Ingests provider data from the SGO feed. Performs entity resolution for events, participants, and event-participant relationships. Enables automated grading and domain analysis at submission time.

---

### Alert Agent — Line Movement Intelligence

| Field | Value |
|-------|-------|
| Process entry | `apps/alert-agent` |
| Core logic | `apps/api/src/alert-agent.ts`, `alert-agent-service.ts`, `alert-notification-service.ts`, `alert-query-service.ts` |
| State | **LIVE** |
| Role | Line movement detection and tier-based notification routing |
| Access | Internal (scheduler-driven) |

The alert agent runs as a standalone process (`apps/alert-agent`). Its process entry point imports repository dependencies and the scheduler from `apps/api/src/` — the detection and notification logic lives there, not in the `apps/alert-agent` package itself.

Runs two passes on a scheduler tick:
1. **Detection pass** (`runAlertDetectionPass()`) — scans `provider_offers` snapshots, classifies `watch` / `notable` / `alert-worthy` by velocity and magnitude
2. **Notification pass** (`runAlertNotificationPass()`) — DB-backed cooldown, tier-based Discord routing

Routing by severity:
- `notable` → canary (30-minute cooldown)
- `alert-worthy` → canary + trader-insights (15-minute cooldown)

Kill switch: `ALERT_DRY_RUN=true` suppresses all Discord delivery.

---

## Discord Channel Registry

### Live Channels

| Channel | Target key | Channel ID | Access | Purpose |
|---------|-----------|-----------|--------|---------|
| Canary | `discord:canary` | `1296531122234327100` | Internal / operator | Permanent integration test lane. Never removed. Not a member-facing channel. |
| Best Bets | `discord:best-bets` | `1288613037539852329` | VIP | Primary premium execution board. High-signal plays. |
| Trader Insights | `discord:trader-insights` | `1356613995175481405` | VIP+ | Edge and market-context board. Sharper threshold than Best Bets. |
| Recaps | `discord:recaps` | `1300411261854547968` | All tiers | Aggregated daily/weekly settlement digest. RecapAgent automated posts only. Visible to every member tier. |

### Blocked Channels (not yet implemented)

| Channel | Target key | Channel ID | Blocker |
|---------|-----------|-----------|---------|
| Exclusive Insights | `discord:exclusive-insights` | `1288613114815840466` | Contract ratified (UTV2-87 READY for codex). Implementation not yet merged. |
| Game Threads | `discord:game-threads` | — | Thread routing not implemented. Architectural gap. |
| Strategy Room | `discord:strategy-room` | — | DM routing not implemented. |

**Do not activate blocked channels without a ratified activation contract and implementation PR.**

---

## Surface State Rules

1. A surface is **LIVE** when it is deployed, connected to the live Supabase project, and has at least one independently verified proof in `docs/06_status/`.
2. A surface is **BLOCKED** when the code exists but it is not connected to a live channel or has a known architectural gap preventing safe activation.
3. A surface is **FUTURE** when it exists only as a contract or spec, with no implementation merged.
4. Canary is always LIVE. Canary is never removed.

---

## Surfaces Not in V2 Scope

The following surfaces exist in the legacy repo but are not part of V2 unless explicitly re-ratified:

- Offer Fetch service wrapper (pure computation ported; service wrapper not yet built)
- Risk Engine service wrapper (pure computation ported; service wrapper not yet built)
- DeviggingService multi-book consensus wrapper (pure computation ported; wrapper not yet built)
- Lab / Backtest surfaces
- Strategy Simulation
- Observation Hub (not yet designed in V2)

See `docs/05_operations/legacy_repo_reference_boundary.md` for the full boundary rule.
