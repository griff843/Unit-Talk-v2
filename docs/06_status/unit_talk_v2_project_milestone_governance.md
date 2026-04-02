# Unit Talk V2 — Project + Milestone Governance

**Status:** RATIFIED  
**Date:** 2026-04-02  
**Authority:** This document is the PM control structure for Unit Talk V2 project organization, milestone logic, issue metadata standard, and readiness determination. Linear is the live source of truth; this document is the contract behind it.

---

## 1. Project Structure

Thirteen projects, each owning a distinct system area. No cross-project overlap in ownership.

| Code | Project | Priority | Owns |
|------|---------|----------|------|
| PS | Product Strategy & Commercial System | Medium | Commercial model, member tier pricing, monetization, platform positioning, capper/syndicate commercial relationships |
| CS | Capper Submission System | Urgent | `apps/smart-form`, browser intake UX, conviction input (1–10), bet slip, live-offer browse, submission validation schema, capper attribution, Playwright e2e |
| GP | System-Generated Pick Engine | Medium | Automated pick generation, alert-agent picks, model-driven picks, system capper identity, hedge detection picks, line movement picks |
| MI | Models, Scoring & Intelligence | High | `packages/domain` scoring logic, promotion evaluation policies, real-edge computation, EdgeSource tracking, CLV wiring, confidence floor policy, model registry, scoring weight validation, walk-forward backtest infrastructure, devig, Kelly sizing |
| LP | Lifecycle, Promotion & Routing | Urgent | `POST /api/submissions`, pick lifecycle FSM (validated→queued→posted→settled→voided), promotion evaluation execution, distribution outbox, worker process, delivery adapters, distribution_receipts, audit_log delivery chain, channel key normalization, rollout controls, circuit breaker |
| DS | Delivery Surfaces | High | `apps/discord-bot`, Discord channel routing, pick embed format, recap posts, alert notifications, member tier Discord roles, slash commands |
| OC | Operator Control Plane | High | `apps/command-center` (port 4300), `apps/operator-web` (port 4200), operator snapshot API, review queue, held queue, exceptions surface, performance surfaces, intelligence surfaces, pick lifecycle trace, dead-letter management, intervention actions |
| SG | Settlement, Grading & Recaps | High | `POST /api/picks/:id/settle`, settlement_records, correction chains (corrects_id FK), settlement idempotency, automated grading, game_results consumption, CLV computation at settlement, settlement recap posting |
| DP | Data, Providers & Canonical Reference | Urgent | `apps/ingestor`, provider_offers, game_results, canonical reference tables, provider alias tables, reference data API endpoints, entity resolution, market key normalization |
| SV | Simulation, Verification & Proof | High | Simulation mode (`UNIT_TALK_SIMULATION_MODE=true`), verification control plane, proof bundle schema, shadow validation, scenario execution, walk-forward backtest as proof mechanism, synthetic data flows |
| PI | Platform, Infrastructure & DevOps | High | CI pipeline, pnpm workspace, TypeScript project references build, Supabase migration management, `@unit-talk/config`, observability stack, structured logging, deployment procedures, process management SOP |
| GC | Security, Governance & Compliance | High | Audit log completeness, writer authority enforcement (`assertFieldAuthority()`), fail-closed runtime behavior, access control policy, compliance documentation, rollback capability, incident response, API security, data retention |
| RD | Production Readiness, Burn-In & Certification | Urgent | Burn-in entry check (E1–E9), canary graduation, G12 gate, Syndicate Ready certification, Fortune-100 Ready certification, overall readiness verdict, operational proof artifacts |

### Ownership boundaries

| Project | Does NOT own |
|---------|-------------|
| CS | API backend promotion logic, operator dashboard, delivery pipeline |
| GP | Human capper submission (CS), scoring models (MI), alert detection logic (MI) |
| MI | Data ingestion, delivery pipeline, UI surfaces |
| LP | Smart Form UI, Command Center UI, scoring models, settlement records, data ingestion |
| DS | Pick lifecycle logic, worker delivery mechanics (LP owns that), scoring |
| OC | API write paths for picks (LP/SG own that), scoring models, data ingestion |
| SG | Data ingestion populating game_results (DP owns that), Command Center settlement UI (OC owns that) |
| DP | Scoring that consumes market data (MI), automated grading (SG), Smart Form browse UX (CS) |
| SV | Production delivery (LP owns that), live DB data (DP owns that) |
| PI | Application-level features, business logic |
| GC | Application feature implementation (enforces contracts on them) |
| RD | Implementation of fixes (lives in area projects). Tracks readiness gates, not code work. |
| PS | Technical implementation of tiers (LP), Discord role management (DS) |

### Dev-mode policy

- **Odds API is dev-primary.** DraftKings, FanDuel, BetMGM, Pinnacle are the primary continuous ingest sources in dev.
- **SGO is non-blocking in dev.** SGO may be limited or non-continuous in the dev environment. This does not block burn-in entry.
- **Simulation mode is valid** for continuous proof scenarios where live Discord delivery is not required.

---

## 2. Milestone Framework

Every project uses the same 5-milestone progression. Milestone names are prefixed with the project code.

| Milestone | Name | Meaning |
|-----------|------|---------|
| M1 | Foundation | Contracts defined, schema migrated, types regenerated, package builds clean |
| M2 | Implementation | Core feature code written, unit tests written and passing |
| M3 | Operational | Process running, DB rows appearing, happy-path confirmed, runtime verified |
| M4 | Proof | Integration tests passing, runtime proof artifact exists, edge cases covered |
| M5 | Production Ready | No open T1/P0 issues in this project. M4 complete. Verified against live DB. |

### Per-project milestone completion criteria

| Project | M1 complete when | M3 complete when | M5 complete when |
|---------|-----------------|-----------------|-----------------|
| CS | Smart Form schema ratified, form renders | Pick submitted from browser, trust signal in DB | E2e Playwright tests pass against live API, Discord delivery confirmed |
| MI | Promotion policies contracted, domain package builds | Scoring running on real picks, no suppression bugs | Scores validated against expected values, CLV wired |
| LP | Outbox schema migrated, worker builds | Qualified pick reaches Discord | No dead-letter leakage, receipts consistent, channel keys canonical |
| DS | Discord bot builds, embed format contracted | Picks appear in correct channels | Recap posts fire, tier routing correct |
| OC | Operator-web builds, snapshot API spec defined | Snapshot returns 200, Command Center loads | All operator surfaces operational, lifecycle trace end-to-end |
| SG | Settlement records schema migrated | Manual settlement completes with 200, no fetch failed | Idempotency proven, correction chain verified, grading pipeline firing |
| DP | Canonical backbone schema migrated | Provider offers accumulating continuously (≥2 batch timestamps) | SGO + Odds API both continuous, canonical tables seeded, reference APIs return 200 |
| SV | Simulation mode flag wired | Full lifecycle runnable in simulation | Proof bundle schema enforced, shadow validation in CI |
| PI | CI pipeline green, pnpm verify passes | Migrations applied, DB types regenerated | Process management SOP documented, observability stack operational |
| GC | Audit log schema complete | All mutations produce audit rows | Fail-closed verified, writer authority enforced |
| RD | E1–E9 entry conditions defined | E1/E2/E3 green | All E1–E9 green, burn-in running, Syndicate Ready gate met |
| PS | Commercial model drafted | Tier pricing documented | Access rules enforced at runtime |
| GP | System pick contract defined | System-generated picks enter lifecycle | Pick source = 'system' correctly attributed, same lifecycle as human picks |

---

## 3. Issue Metadata Standard

Every issue in Linear must have all 12 mandatory fields. Issues missing required fields must not be executed.

| Field | Required | Values |
|-------|----------|--------|
| **Project** | Yes | One of the 13 projects above |
| **Milestone** | Yes | `{code}-M1` through `{code}-M5` |
| **Tier** | Yes | T1 / T2 / T3 |
| **Priority** | Yes | P0 / P1 / P2 / P3 |
| **Lane** | Yes | Claude / Codex / PM-review / Joint |
| **Kind** | Yes | bug / feature / contract / migration / hardening / proof / runtime |
| **Area** | Yes | The primary `apps/` or `packages/` area |
| **Acceptance criteria** | Yes | Explicit, testable criteria |
| **Dependencies** | Yes | Issue IDs or "None" |
| **Burn-in blocker** | Yes | YES / NO |
| **Proof required** | Yes | YES / NO — if YES, a runtime proof artifact must exist |
| **Docs required** | Yes | YES / NO — if YES, docs must be updated before close |

### Tier definitions

| Tier | Meaning | Examples |
|------|---------|---------|
| T1 | Production truth — lifecycle, delivery, settlement, routing, burn-in blockers | Migrations, outbox routing, lifecycle FSM, settlement path, E1–E9 entry conditions |
| T2 | Operational / cross-system — operator surfaces, scoring, data health | Scoring bugs, operator queries, channel key normalization, dead-letter annotation |
| T3 | UX / enhancement — cosmetic, non-blocking polish | Form labels, embed formatting, dashboard styling |

### Priority definitions

| Priority | Meaning |
|----------|---------|
| P0 | Blocks capper → Discord (minimum operation path) or blocks lifecycle correctness |
| P1 | Blocks operator trust, operator verification, or daily validation workflow |
| P2 | Important but not blocking daily operations |
| P3 | Nice-to-have polish |

---

## 4. Done Definition

An issue is Done when ALL five conditions are met:

1. **Code** — implementation merged to main
2. **Runtime** — DB rows or process behavior confirms the code is live (not just merged)
3. **Proof** — acceptance criteria verified against live DB or runtime (not just unit test pass)
4. **Docs** — if `Docs required = YES`, relevant doc updated and committed
5. **No blocking issues** — no new T1/P0 issues opened as a direct consequence

Issues may not be closed on code merge alone. Runtime proof is required.

---

## 5. Production Readiness Logic

### Minimum Operation (pre-burn-in threshold)

The system is at Minimum Operation when the critical path is unbroken:

```
Smart Form submission → API → DB → promotion evaluation → outbox → worker → Discord:canary
```

All of the following must be true:
- At least one pick reaches Discord:canary within 24h
- Confidence floor works correctly (conviction=5 → no suppression)
- Worker running with `UNIT_TALK_WORKER_AUTORUN=true`
- No T1/P0 burn-in blockers open

### Production Ready (burn-in start condition)

All 9 burn-in entry conditions (E1–E9) must be green:

| Condition | Description |
|-----------|-------------|
| E1 | `pnpm verify` exits 0 |
| E2 | `pnpm type-check` exits 0 |
| E3 | At least one capper actively submitting real picks |
| E4 | SGO ingestor running and inserting rows |
| E5 | Odds API ingestor configured and returning data (≥2 distinct batch timestamps) |
| E6 | Worker process running with `UNIT_TALK_WORKER_AUTORUN=true` |
| E7 | Operator snapshot accessible (`GET /api/operator/snapshot` → 200) |
| E8 | Command Center accessible at port 4300 |
| E9 | Discord canary delivery confirmed in last 24h |

**Formula:** Production Ready = All projects M4+ AND no open T1/P0 issues AND E1–E9 green

### Syndicate Ready

Syndicate Ready requires Production Ready plus:
- All 13 projects at M5
- Scoring/lifecycle/delivery consistent — no scoring drift, no routing bugs
- No dead-letter leakage from real picks (test/proof picks may remain)
- Channel key normalization enforced — no `discord:#canary` or raw channel IDs in receipts
- Recap posts firing after settlement
- Operator trace end-to-end without DB spelunking

### Fortune-100 Ready

Fortune-100 Ready requires Syndicate Ready plus:
- Observability complete — structured logs, Loki/Grafana operational, all mutations audited
- Governance/audit trails complete — `assertFieldAuthority()` enforced, all mutations produce audit rows, correction chains proven
- Full operational control + rollback — documented rollback procedure, simulation mode proven as safe test lane, incident response procedures written
- Access control policy enforced at runtime
- Data retention policy documented

---

## 6. Current Project Status Snapshot

*As of 2026-04-02. Active issues only.*

| Issue | Title | Project | Milestone | Tier | Priority | Status |
|-------|-------|---------|-----------|------|----------|--------|
| UTV2-250 | Smart Form V1 conviction proof | CS | CS-M2 | T1 | P0 | In Progress |
| UTV2-251 | Smart Form Playwright e2e | CS | CS-M4 | T2 | P1 | Ready |
| UTV2-252 | Provider state addendum | DP | DP-M3 | T2 | P1 | Done |
| UTV2-253 | Command Center truth surfaces | OC | OC-M3 | T2 | P1 | In Progress |
| UTV2-254 | Fresh-pick intelligence proof | MI | MI-M4 | T1 | P0 | Ready |
| UTV2-255 | Promotion truth verification | MI | MI-M4 | T1 | P0 | Done |
| UTV2-256 | Burn-in entry check E1–E9 | RD | RD-M3 | T1 | P0 | In Progress |
| UTV2-259 | Smart Form production-ready | CS | CS-M5 | T1 | P0 | Ready |
| UTV2-276 | Apply canonical backbone migrations | DP | DP-M3 | T1 | P0 | Ready |
| UTV2-277 | Apply settlement idempotency migration | SG | SG-M3 | T1 | P0 | Ready |
| UTV2-278 | Restart API/worker/ingestor | LP | LP-M3 | T1 | P0 | Ready |
| UTV2-279 | Verify confidence floor bypass | MI | MI-M3 | T1 | P0 | Ready |
| UTV2-280 | Minimum operation proof | RD | RD-M2 | T1 | P0 | Ready |
| UTV2-281 | Verify canonical browse/search APIs | DP | DP-M3 | T1 | P1 | Ready |
| UTV2-282 | Verify settlement path | SG | SG-M3 | T1 | P1 | Ready |
| UTV2-283 | Dead-letter source annotation | OC | OC-M3 | T2 | P2 | Ready |
| UTV2-284 | Board cap policy review | MI | MI-M3 | T2 | P2 | Ready |
| UTV2-285 | Backfill capper attribution | CS | CS-M3 | T2 | P2 | Ready |
| UTV2-286 | SGO ingest health check | DP | DP-M5 | T1 | P0 | Ready |
| UTV2-287 | Normalize distribution_receipts channel keys | LP | LP-M3 | T2 | P1 | Ready |

### Burn-in entry condition status (as of 2026-04-02)

| Condition | Status | Blocker |
|-----------|--------|---------|
| E1 — pnpm verify exits 0 | GREEN | — |
| E2 — pnpm type-check exits 0 | GREEN | — |
| E3 — capper actively submitting | GREEN | — |
| E4 — SGO inserting rows | RED | SGO stalled since 2026-03-27. Requires UTV2-286. |
| E5 — Odds API returning data | PARTIAL | Single batch only. Needs continuous schedule. |
| E6 — Worker running | UNVERIFIED | Requires runtime check |
| E7 — Operator snapshot accessible | UNVERIFIED | Requires runtime check |
| E8 — Command Center accessible | UNVERIFIED | Requires runtime check |
| E9 — Discord canary delivery last 24h | RED | Last delivery 2026-04-01 07:20 UTC. Requires UTV2-278. |

---

## 7. Execution Order for Minimum Operation

The critical path from Smart Form submission to Discord delivery requires these issues in sequence:

1. **UTV2-276** (DP) — Apply canonical backbone migrations (PM-review lane, P0)
2. **UTV2-277** (SG) — Apply settlement idempotency migration (PM-review lane, P0)
3. **UTV2-278** (LP) — Restart API/worker/ingestor with correct config (PM-review lane, P0)
4. **UTV2-279** (MI) — Verify confidence floor bypass is live (Claude lane, P0)
5. **UTV2-281** (DP) — Verify canonical browse/search APIs (Claude lane, P1)
6. **UTV2-282** (SG) — Verify settlement path (PM-review lane, P1)
7. **UTV2-287** (LP) — Normalize channel keys (Claude lane, P1)
8. **UTV2-286** (DP) — SGO ingest health check and restart (Joint lane, P0)
9. **UTV2-280** (RD) — Minimum operation proof (Claude lane, P0)

These are burn-in blockers. Nothing in UTV2-256 can be marked green until these complete.

---

## 8. Governance Rules

### Issue lifecycle rules

- Issues not represented in Linear are not executed unless directly requested by PM in-session (in which case create the Linear issue as part of execution)
- T1/migrations/runtime routing/shared contracts require explicit PM approval before merge
- T3/docs/isolated UI may merge on green without ceremony
- Issues may not be marked Done on code merge alone — runtime proof required

### Scope control rules

- Do not widen the active milestone scope
- Do not start M(N+1) before M(N) is formally closed at the project level
- Do not add new channels or product surfaces without a contract in GC
- Do not activate deferred Discord channels: `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`
- Do not add write surfaces to operator-web
- Do not mutate settlement history

### Anti-drift rules

- docs define intent; runtime enforces truth; tests prove runtime truth; docs update only to match enforced reality
- if something exists only in docs → `docs-only`; only in config → `config-only`; only in tests → `test-only`
- Be aggressive about deletion: obsolete templates, superseded prompts, stale artifact indexes, duplicate proof files

### Old project cleanup

The following 7 projects were created in Phase 1 and are superseded by the 13-project structure above. They should be marked Completed in Linear:
- Smart Form (old SF)
- Command Center (old CC)
- Lifecycle + Delivery (old LD)
- Scoring + Intelligence (old SI)
- Settlement (old SE)
- Provider Ingest + Reference Data (old PI)
- Production Readiness / Burn-In (old PR)

All active issues have been remapped to the 13-project structure. The old projects contain no active issues.
