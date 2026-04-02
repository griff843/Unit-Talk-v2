# Unit Talk V2 — Project + Milestone Governance

**Status:** RATIFIED — Hardened 2026-04-02  
**Authority:** This document is the structural contract behind the Linear execution system. It defines project ownership, milestone logic, issue metadata standards, execution lane rules, proof standards, and readiness criteria.

### Source of Truth Hierarchy

| What | Source of Truth |
|------|----------------|
| Issue state, milestone progress, project readiness, blocker state | **Linear** |
| Code relationships, implementation reality | **Repo (main branch)** |
| Structural standards, contracts, readiness model, issue protocol | **This document** |
| Runtime truth (what is live, what rows exist) | **Live DB / running processes** |

**Docs are NOT the source of truth for status.** If this doc disagrees with Linear, Linear wins. If Linear disagrees with the live DB, the DB wins.

---

## 1. Project Structure

Thirteen projects. Each owns a distinct system area. No cross-project ownership overlap.

| Code | Project | Priority | Owns |
|------|---------|----------|------|
| PS | Product Strategy & Commercial System | Medium | Commercial model, member tier pricing, monetization, platform positioning, capper/syndicate commercial relationships, access tier definitions |
| CS | Capper Submission System | Urgent | `apps/smart-form`, browser intake UX, conviction input (1–10), bet slip, live-offer browse, submission validation schema, capper attribution, Playwright e2e coverage |
| GP | System-Generated Pick Engine | High | System-generated picks as canonical lifecycle entities (`source = 'system'`), alert-agent picks, model-driven picks, system capper identity, hedge detection picks, line movement picks — **full lifecycle, promotion, operator visibility, settlement/analytics** |
| MI | Models, Scoring & Intelligence | High | `packages/domain` scoring logic, promotion evaluation policies (best-bets, trader-insights, exclusive-insights), real-edge computation, EdgeSource tracking, CLV wiring, confidence floor policy, model registry, scoring weight validation, walk-forward backtest infrastructure, devig, Kelly sizing |
| LP | Lifecycle, Promotion & Routing | Urgent | `POST /api/submissions`, pick lifecycle FSM (validated→queued→posted→settled→voided), promotion evaluation execution, distribution outbox, worker process, delivery adapters, `distribution_receipts`, audit_log delivery chain, channel key normalization, rollout controls, circuit breaker |
| DS | Delivery Surfaces | High | `apps/discord-bot`, Discord channel routing, pick embed format, recap posts, alert notifications, member tier Discord roles, slash commands (/stats, /recap, /pick, /leaderboard, /help) |
| OC | Operator Control Plane | High | `apps/command-center` (port 4300), `apps/operator-web` (port 4200), operator snapshot API, review queue, held queue, exceptions surface, performance surfaces, intelligence surfaces, pick lifecycle trace, dead-letter management, intervention actions |
| SG | Settlement, Grading & Recaps | High | `POST /api/picks/:id/settle`, `settlement_records`, correction chains (`corrects_id` FK), settlement idempotency, automated grading, `game_results` consumption, CLV at settlement, settlement recap posting |
| DP | Data, Providers & Canonical Reference | Urgent | `apps/ingestor`, `provider_offers`, `game_results`, canonical reference tables, provider alias tables, reference data API endpoints, entity resolution, market key normalization |
| SV | Simulation, Verification & Proof | High | Simulation mode (`UNIT_TALK_SIMULATION_MODE=true`), verification control plane (`packages/verification`), proof bundle schema, shadow validation, scenario execution, walk-forward backtest as proof mechanism, synthetic data flows |
| PI | Platform, Infrastructure & DevOps | High | CI pipeline, pnpm workspace, TypeScript project references build, Supabase migration management, `@unit-talk/config`, observability stack, structured logging (`@unit-talk/observability`), deployment procedures, process management SOP |
| GC | Security, Governance & Compliance | High | Audit log completeness, writer authority enforcement (`assertFieldAuthority()`), fail-closed runtime behavior, access control policy, compliance documentation, rollback capability, incident response, API security, data retention |
| RD | Production Readiness, Burn-In & Certification | Urgent | Burn-in entry check (E1–E9), canary graduation, G12 gate, Syndicate Ready certification, Fortune-100 Ready certification, overall readiness verdict, operational proof artifacts |

### Ownership Boundaries

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

### System-Generated Pick Engine — Canonical Definition

**System-generated picks are real picks (Option A, ratified 2026-04-02).**

A system-generated pick:
- Is created with `source = 'system'` (or `source = 'alert-agent'`, `source = 'model-driven'`)
- Has a `picks` row in the database
- Follows the same lifecycle FSM as human picks (validated → queued → posted → settled → voided)
- Is evaluated by promotion policies (may qualify for best-bets, trader-insights)
- Is visible in operator surfaces with source attribution
- Is eligible for settlement, grading, and CLV computation

Alert-only notifications (Discord alerts without a picks row) are **not** system picks. System picks are full lifecycle entities.

GP-M1 is unblocked by this definition. See GP milestone criteria.

---

## 2. Milestone Framework

Every project uses the same 5-milestone progression.

| Milestone | Name | Meaning |
|-----------|------|---------|
| M1 | Foundation | Contracts defined, schema migrated, types regenerated, package builds clean |
| M2 | Implementation | Core feature code written, unit tests written and passing |
| M3 | Operational | Process running, DB rows appearing, happy-path confirmed, runtime verified |
| M4 | Proof | Integration tests passing, runtime proof artifact exists, edge cases covered. **For UI/workflow systems: Playwright or equivalent browser automation required.** |
| M5 | Production Ready | No open T1/P0 issues. M4 complete. Verified against live DB. |

### Per-Project Milestone Completion Criteria

| Project | M1 complete when | M3 complete when | M5 complete when |
|---------|-----------------|-----------------|-----------------|
| CS | Smart Form schema ratified, conviction input spec locked, form renders | Pick submitted from browser, trust signal in DB, attribution correct on new submissions | Playwright e2e tests pass against live API; full browser→DB→Discord chain proven by human-behavior simulation |
| GP | System-generated pick contract ratified; `source = 'system'` lifecycle contract defined | System picks created, enqueued, delivered, operator-visible with source attribution | System picks indistinguishable from human picks in lifecycle/operator surfaces (except `source` field) |
| MI | Promotion policies contracted, domain package builds | Scoring running on real picks, no suppression bugs, confidence floor operating correctly | Scores validated against expected values, CLV wired, walk-forward backtest producing output |
| LP | Outbox schema migrated, worker builds | Qualified pick reaches Discord:canary; worker running; receipts written with canonical channel keys | No dead-letter leakage from real picks; receipts consistent; circuit breaker proven |
| DS | Discord bot live, embed format contracted, channel map ratified | Picks appear in correct channels with correct embed; recap posts fire after settlement | Discord surface stable over 7-day burn-in; no routing errors; tier routing correct |
| OC | Operator-web builds, snapshot API spec defined | Snapshot returns 200 with valid health payload; Command Center loads at port 4300; no 500 errors | All operator surfaces operational; lifecycle trace end-to-end without DB spelunking |
| SG | Settlement records schema migrated, idempotency index applied | Manual settlement completes via operator UI with no `fetch failed` error; settlement record written | Idempotency proven; correction chain verified; grading pipeline firing; CLV at settlement |
| DP | Canonical backbone schema files written (repo) | Migrations applied to Supabase; provider offers accumulating continuously (≥2 batch timestamps); reference APIs return 200 | Canonical tables seeded; entity resolution working; ingest continuity proven over multiple days |
| SV | Simulation mode contract ratified, proof bundle schema defined | Full lifecycle provable via simulation without live Discord delivery; operator snapshot detects simulation mode | Proof bundles committed for all T1 merges; simulation used as standard pre-production validation |
| PI | CI pipeline green, pnpm verify passes | All migrations applied; `database.types.ts` regenerated and in sync; process management SOP documented | Migration drift = 0 for 7+ days; observability dashboards showing real data; deployment runbook complete |
| GC | Audit log schema complete, writer authority contract ratified | All T1 mutations produce audit_log rows with correct entity_id and entity_ref | Full audit trail for production picks; rollback procedure tested; rate limiting proven |
| RD | E1–E9 entry conditions defined | Dev burn-in entry conditions met (E4 waived per dev policy) | All E1–E9 green including E4; burn-in running; Syndicate Ready gate met |
| PS | Commercial model drafted | Tier pricing documented, access rules enforced at runtime | Commercial model stable over first syndicate cohort |

---

## 3. Execution Lane Protocol

There are exactly two AI execution lanes:

| Lane | Executes | Examples |
|------|---------|---------|
| **Claude** | Architecture, audits, verification, issue design, proof validation, root cause analysis, controlled fixes requiring reasoning, governance | Verify runtime state, diagnose delivery failures, audit log completeness checks, issue correction, contract drafting |
| **Codex** | Implementation, schema changes, endpoints, runtime fixes, test writing, type generation, isolated refactors with explicit file scope | Normalize channel keys, regenerate types, write Playwright tests, implement endpoints, fix delivery adapter |

### Human-Action Required Flag

Some issues require a human operator to execute with system credentials. These are not AI-executable:
- Applying Supabase migrations (`supabase db push` or Supabase dashboard)
- Starting/restarting runtime processes with environment variables
- Executing manual SQL corrections (backfills, one-time data fixes)

These issues are labeled `Human-action: YES`. The execution lane (Claude or Codex) coordinates and verifies; the human PM executes.

**`PM-review` is NOT an execution lane.** It is a review flag only.

### Review Required Flag

| Flag | Meaning |
|------|---------|
| `Review: PM` | T1 changes, migrations, runtime routing, shared contracts — PM must approve before close |
| `Review: None` | T2/T3 isolated work — close on green |

---

## 4. Issue Metadata Standard

Every issue in Linear must have all mandatory fields. Issues with incomplete metadata must not be executed (exception: PM-approved emergency work with explicit waiver).

| Field | Required | Values |
|-------|----------|--------|
| **Project** | Yes | One of the 13 projects above |
| **Milestone** | Yes | `{code}-M1` through `{code}-M5` |
| **Tier** | Yes | T1 / T2 / T3 |
| **Priority** | Yes | P0 / P1 / P2 / P3 |
| **Lane** | Yes | `Claude` or `Codex` |
| **Human-action** | Yes | `YES` or `NO` |
| **Review** | Yes | `PM` or `None` |
| **Kind** | Yes | `bug` / `feature` / `contract` / `migration` / `hardening` / `proof` / `runtime` / `schema` |
| **Area** | Yes | The primary `apps/` or `packages/` area |
| **Acceptance criteria** | Yes | Explicit, testable criteria — not vague goals |
| **Dependencies** | Yes | Issue IDs or `None` |
| **Burn-in blocker** | Yes | `YES` or `NO` |
| **Proof required** | Yes | Exact proof artifact (SQL query, pnpm command, Playwright run, or `NONE`) |
| **Docs required** | Yes | Exact doc path or `NONE` |

### Tier Definitions

| Tier | Meaning | Examples |
|------|---------|---------|
| T1 | Production truth — lifecycle, delivery, settlement, routing, migrations, burn-in blockers | Outbox routing, lifecycle FSM, settlement path, E1–E9 conditions, canonical migrations |
| T2 | Operational / cross-system — operator surfaces, scoring, data health, receipt normalization | Scoring bugs, channel key normalization, dead-letter annotation, operator queries |
| T3 | UX / enhancement — cosmetic, non-blocking polish | Form labels, embed formatting, dashboard styling |

### Priority Definitions

| Priority | Meaning |
|----------|---------|
| P0 | Blocks the minimum operation path (capper submission → lifecycle → outbox → worker → Discord → receipt) |
| P1 | Blocks operator trust, operator verification, or daily validation workflow |
| P2 | Important but not blocking daily operations |
| P3 | Nice-to-have polish |

---

## 5. Done Definition

An issue is Done when ALL five conditions are met:

1. **Code** — implementation merged to main (or not applicable for proof-only issues)
2. **Runtime** — DB rows or process behavior confirms the code is live (not just merged)
3. **Proof** — acceptance criteria verified against live DB or runtime. See proof standard below.
4. **Docs** — if `Docs required ≠ NONE`, relevant doc updated and committed
5. **No blocking consequences** — no new T1/P0 issues opened as a direct result

**Issues may not be closed on code merge alone. Runtime proof is always required.**

---

## 6. Mandatory Proof Standard

### Rule: Unit tests are necessary but insufficient for readiness proof.

Unit tests and integration tests validate internal logic. They do not prove a system works as a user would experience it. Readiness proof requires exercising the real surface.

### For UI / App / Workflow Issues (M4 and above)

**Playwright or equivalent browser automation is required** as the default proof standard for:
- Smart Form submission flows (CS)
- Command Center operator workflows (OC)
- Settlement operator UI flows (SG, via OC)
- Any issue claiming production-readiness of a browser-accessible surface

Hard-coded unit tests against fake data **do not count** as production-readiness proof. A test that always passes because it tests a fixture is not a readiness signal — it is a regression guard.

### For Backend / Pipeline Issues

Live DB proof is required:
- SQL queries against the live Supabase instance
- Operator snapshot JSON showing correct state
- `distribution_receipts` rows confirming delivery
- `audit_log` rows confirming mutations were logged

### Proof Specification in Issues

Every issue must specify exactly what proof will be produced. Examples:

| Issue type | Proof required |
|-----------|---------------|
| Submission flow | Playwright run: submit pick → verify DB row via API response |
| Discord delivery | `SELECT channel, status FROM distribution_receipts WHERE ...` |
| Lifecycle transition | `SELECT status FROM picks WHERE id = ?` |
| Type regen | `pnpm type-check` exit 0 + diff of database.types.ts |
| Settlement path | Operator UI walkthrough + `SELECT * FROM settlement_records WHERE ...` |
| Operator surface | Playwright: load URL, assert page renders, check network requests |

**"Tests pass" is not proof. Proof is runtime truth.**

---

## 7. Readiness Model

### Minimum Operation (pre-burn-in floor)

The critical path is unbroken:
```
Smart Form submission → API → DB → promotion evaluation → outbox → worker → Discord:canary → distribution_receipt
```

All of the following must be true:
- At least one pick reaches Discord:canary within 24h
- Confidence floor bypass active for `source = 'smart-form'` (conviction=5 → no suppression)
- Worker running with `UNIT_TALK_WORKER_AUTORUN=true`
- No T1/P0 burn-in blockers open in LP, CS, or MI projects

### Dev Burn-In Entry Conditions

| Condition | Required for dev? | Notes |
|-----------|------------------|-------|
| E1 — `pnpm verify` exits 0 | YES | |
| E2 — `pnpm type-check` exits 0 | YES | |
| E3 — Capper actively submitting real picks | YES | |
| E4 — SGO ingestor inserting rows | **NO (dev waiver)** | Odds API is dev-primary. SGO non-blocking in dev. |
| E5 — Odds API ≥2 distinct batch timestamps | YES | Dev-primary ingest source |
| E6 — Worker running with AUTORUN=true | YES | |
| E7 — Operator snapshot returns 200 | YES | |
| E8 — Command Center loads at port 4300 | YES | |
| E9 — Discord canary delivery in last 24h | YES | |

**Dev burn-in can start with E4 waived.** E4 is required for production burn-in.

### Production Burn-In Entry Conditions

All E1–E9 required including E4 (SGO continuity).

### Production Ready (G12 gate)

All of the following:
- Dev burn-in running for 7+ days with real picks
- 30+ graded picks in DB
- All 13 projects at M4 or higher
- No open T1/P0 issues in any project
- Delivery health sustained (no stuck outbox, no dead-letter from real picks)
- Evidence bundle committed per `PRODUCTION_READINESS_CANARY_PLAN.md`

### Syndicate Ready

Production Ready plus:
- All 13 projects at M5
- Scoring/lifecycle/delivery consistent over 7-day period
- No dead-letter leakage from real picks
- Channel keys canonical in all receipts
- Recap posts firing after settlement
- Operator trace end-to-end without DB spelunking
- System-generated picks (GP) flowing with correct attribution

### Fortune-100 Ready

Syndicate Ready plus:
- Observability complete: structured logs, Loki/Grafana operational, all mutations audited
- Governance: `assertFieldAuthority()` enforced in code, audit log complete for all T1 paths, correction chains proven
- Full operational control: documented rollback procedure tested, incident response procedures written
- Access control enforced at runtime for all member tiers
- Data retention policy documented and enforced

---

## 8. Issue Creation Protocol

### Pre-Creation Checks

Before creating a new issue:
1. Search Linear for existing issues covering the same scope
2. Confirm the correct project and milestone
3. Verify all 14 mandatory fields can be populated
4. If dependencies are unknown, leave empty and flag — do not guess

### When to Create

Create an issue only when:
- It is required to complete the next incomplete milestone
- It has been directly requested by PM
- It surfaces a confirmed gap in runtime truth

### When Not to Create

Do not create issues for:
- Future milestones beyond the next incomplete one (list them, do not create them)
- Work that is already covered by an existing issue
- Vague improvements without testable acceptance criteria
- Guessed dependencies or speculative fixes

### Execution Rules

- Agents must check Linear state before starting work
- If an issue's metadata is incomplete, correct it before executing (unless PM-approved emergency)
- New issues discovered during execution must be created in Linear before being tracked as work
- No work proceeds from vague issues — if acceptance criteria are unclear, clarify first

### Anti-Drift Rules

- docs define intent; runtime enforces truth; tests prove runtime truth; docs update to match enforced reality only
- if something exists only in docs: label `docs-only`; only in config: `config-only`; only in tests: `test-only`
- be aggressive about deletion: obsolete templates, superseded prompts, stale artifact indexes, duplicate proof files
- issue milestones must not skip levels: close M3 before opening M4 work

---

## 9. Bootstrap-Only Status Snapshot

**The section below is a bootstrap artifact only. It reflects the state as of 2026-04-02 when this governance system was initialized.**

**After this date: Linear is the authoritative source for project and issue status. Do not update this section. Do not use it to infer current state.**

---

### Bootstrap Issue Map (2026-04-02 — do not use for current state)

| Issue | Project | Milestone | Tier | P | Lane | Status at init |
|-------|---------|-----------|------|---|------|----------------|
| UTV2-250 | CS | CS-M2 | T1 | P0 | Claude | In Progress |
| UTV2-251 | CS | CS-M4 | T2 | P1 | Codex | In Progress |
| UTV2-252 | DP | DP-M3 | T2 | P1 | Claude | In Progress |
| UTV2-253 | OC | OC-M3 | T2 | P1 | Claude | In Progress |
| UTV2-254 | MI | MI-M4 | T1 | P0 | Claude | Ready |
| UTV2-255 | MI | MI-M4 | T1 | P0 | Claude | Ready |
| UTV2-256 | RD | RD-M3 | T1 | P0 | Claude | Ready |
| UTV2-259 | CS | CS-M5 | T1 | P0 | Claude | In Progress |
| UTV2-260 | LP | LP-M3 | T1 | P1 | Claude | Backlog |
| UTV2-261 | CS | CS-M3 | T3 | P2 | Codex | Backlog |
| UTV2-262 | CS | CS-M3 | T3 | P3 | Codex | Backlog |
| UTV2-276 | DP | DP-M3 | T1 | P0 | Codex, Human-action:YES | Ready |
| UTV2-277 | SG | SG-M3 | T1 | P0 | Claude, Human-action:YES | Ready |
| UTV2-278 | LP | LP-M3 | T1 | P0 | Claude, Human-action:YES | Ready |
| UTV2-279 | MI | MI-M3 | T1 | P0 | Claude | Ready |
| UTV2-280 | RD | RD-M2 | T1 | P0 | Claude | Ready |
| UTV2-281 | DP | DP-M3 | T1 | P1 | Claude | Ready |
| UTV2-282 | SG | SG-M3 | T1 | P1 | Claude | Ready |
| UTV2-283 | OC | OC-M3 | T2 | P2 | Codex | Backlog |
| UTV2-284 | MI | MI-M3 | T2 | P2 | Claude | Backlog |
| UTV2-285 | CS | CS-M3 | T2 | P2 | Codex, Human-action:YES | Backlog |
| UTV2-286 | DP | DP-M5 | T2 | P2 | Claude | Backlog |
| UTV2-287 | LP | LP-M3 | T2 | P1 | Codex | Ready |
| UTV2-288 | OC | OC-M3 | T1 | P1 | Claude | Backlog |
| UTV2-289 | DS | DS-M3 | T2 | P1 | Claude | Backlog |
| UTV2-290 | PI | PI-M3 | T1 | P1 | Codex | Backlog |
| UTV2-291 | GC | GC-M3 | T2 | P2 | Claude | Backlog |
| UTV2-292 | SV | SV-M3 | T2 | P2 | Claude | Backlog |

---

## 10. Execution Order for Minimum Operation

The P0 critical path in sequence:

1. **UTV2-276** — Apply canonical backbone migrations (Human-action; PM executes `supabase db push`)
2. **UTV2-277** — Apply settlement idempotency migration (Human-action; PM executes)
3. **UTV2-290** — Regenerate database.types.ts (Codex; after migrations applied)
4. **UTV2-278** — Restart API, worker, ingestor with correct config (Human-action; PM starts processes)
5. **UTV2-279** — Verify confidence floor bypass at runtime (Claude)
6. **UTV2-287** — Normalize channel keys implementation (Codex)
7. **UTV2-260** — Trace and validate submission-to-Discord lifecycle (Claude)
8. **UTV2-280** — Minimum operation proof: Smart Form → Discord confirmed (Claude)

After minimum operation confirmed:
- UTV2-281 (browse/search API verification)
- UTV2-282 (settlement path verification)
- UTV2-288 (operator snapshot + Command Center accessible)
- UTV2-289 (Discord embed format + channel routing confirmed)
- UTV2-256 (burn-in entry check — mark individual E conditions green)

---

## 11. Governance Rules

### Issue lifecycle

- Issues not in Linear are not executed unless directly PM-requested (create the issue first)
- T1/migrations/runtime routing/shared contracts require `Review: PM` before close
- T2/T3 isolated work may close on green with `Review: None`
- Issues may not be closed on code merge alone — runtime proof is always required
- Issues with incomplete metadata must not be executed

### Scope control

- Do not widen active milestone scope
- Do not open M(N+1) issues before M(N) is formally closed at the project level
- Do not add new channels or product surfaces without a contract ratified in GC
- Do not activate deferred Discord channels: `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`
- Do not add write surfaces to `apps/operator-web`
- Do not mutate `settlement_records` — corrections use the `corrects_id` chain only
