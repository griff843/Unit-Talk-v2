# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
pnpm test              # all unit tests
pnpm test:db           # DB smoke test against live Supabase (requires SUPABASE_SERVICE_ROLE_KEY)
pnpm type-check        # TypeScript project-references build check
pnpm build             # compile all packages and apps
pnpm lint              # ESLint
pnpm verify            # env:check + lint + type-check + build + test

# Run a single test file
tsx --test apps/api/src/submission-service.test.ts

# Regenerate Supabase types after a migration
pnpm supabase:types
```

Tests use `node:test` + `tsx --test`. No Jest, no Vitest. Assertions use `node:assert/strict`.

Environment is loaded from `local.env` (gitignored, has real credentials) > `.env` (gitignored) > `.env.example` (template). No dotenv package — `@unit-talk/config` parses env files directly. The Supabase project ref is `feownrheeefbcsehtsiw`.

## Execution Model

Claude Code is the execution orchestrator for Unit Talk V2. The job is to work the Linear backlog continuously until there are no executable issues left. When a green-state recovery sprint is active, recovery work (worker stability, repo hygiene, docs truth-sync) takes precedence over all feature work.

### Authority

- **Linear is the only execution queue.** `ISSUE_QUEUE.md` is a historical record updated after merges — it does not determine what to work on.
- **GitHub main is shipped truth.** Repo docs mirror shipped truth after merge.
- **Direct PM instructions in-session override the Linear-only rule.** Create the Linear issue as part of execution if one does not exist.
- Do not work on anything that is not represented in Linear or directly requested by the PM.

### Start-of-Session Checklist

0. Run `pnpm ops:brief`
0a. Run `pnpm worker:status` — confirm worker is UP before proceeding
0b. Run `pnpm codex:status` — see what Codex CLI lanes are active or returned (receive any returned work first)
1. Read Linear issues in Ready, In Progress, and In Review states
2. Reconcile Linear state against repo truth on main (mark already-merged issues Done, detect stale states)
3. Run `pnpm codex:classify` — auto-classify Ready issues into codex-safe vs claude-only
4. Read `docs/06_status/PROGRAM_STATUS.md` for current milestone context
5. Read `docs/05_operations/docs_authority_map.md` for authority tiers

CLI-first helpers for these checks:
- `pnpm ops:brief` ← default one-command snapshot (includes Codex Lanes section)
- `pnpm codex:status` ← Codex CLI lane health
- `pnpm codex:classify` ← auto-classify Ready issues into dispatch queue
- `pnpm linear:work`
- `pnpm queue:status`
- `pnpm github:current`

Then answer:
- What milestone is active?
- What Linear issues are executable?
- What is blocked and why?

If any of those are unclear, stop and resolve before making changes.

### Core Loop

Repeat until no executable issues remain:

1. Read all Linear issues in Ready, In Progress, and In Review
2. Reconcile Linear state against repo truth on main
   - Mark already-merged issues Done
   - Detect stale In Review / In Progress / Ready states
   - Identify duplicates and blocked issues
3. Build an execution batch only from executable Linear issues
4. Classify each issue into exactly one bucket:
   - **Claude-only** — execute directly in auto mode
   - **Codex-safe** — generate exact execution packet and dispatch
   - **blocked** — mark and report blocker
   - **needs-contract / needs-reshaping** — stop and report
5. Execute Claude-only issues directly
6. For Codex-safe issues, dispatch with exact task packets (see Codex Prompt Template below)
7. Review returned work
8. Run required verification
9. Merge according to risk tier
10. Update Linear with PR/commit/merge truth
11. Repeat

CLI-first preference:
- start with `pnpm ops:brief`; only drill down if the brief flags risk, ambiguity, or missing context
- use `pnpm linear:work` or `pnpm linear:issues` to read queue state
- use `pnpm linear:update` / `pnpm linear:comment` / `pnpm linear:close` for routine Linear sync
- use `pnpm github:current`, `pnpm github:summary -- <pr>`, or `pnpm github:checks -- <pr>` for PR status/check truth
- use `pnpm proof:t1` as the default T1 proof/verification bundle
- use repo scripts or API routes for Supabase/runtime verification before reaching for MCP

### Classification Rules

**Claude-only** — use for:
- cross-cutting refactors
- shared contracts/types
- shared route or repository changes
- scoring/promotion/lifecycle logic
- governance/status reconciliation
- any issue with ambiguity
- any issue that overlaps another active task
- any T1 issue

**Codex-safe** — only delegate when ALL are true:
- the issue exists in Linear
- scope is explicit
- acceptance criteria are explicit
- allowed files are explicit
- no migration
- no shared contract/type overlap with active work
- no overlapping routes/tests likely to collide
- verification path is independent

### Concurrency

**Claude Code (in this terminal):**
- Max 3 parallel Claude agent lanes (worktree isolated)
- Claude Code is the only merge authority — it reviews and merges all PRs

**Codex CLI (separate terminal):**
- Max 3 parallel Codex CLI lanes when file scope is fully isolated
- Codex CLI creates PRs — it never merges directly
- All Codex returns must pass `pnpm codex:receive` gate before merge

**Total max simultaneous lanes: 6 (3 Claude + 3 Codex CLI)**

**Dispatch flow:**
1. `pnpm codex:classify` — auto-classify Ready issues
2. `pnpm codex:dispatch -- --issue UTV2-XXX` — generate packet + register lane
3. Paste packet into Codex CLI terminal
4. When Codex returns: `pnpm codex:receive -- --issue UTV2-XXX --branch <b> --pr <url>`
5. Review diff, then merge via Claude Code only

**Do not exceed 3 Codex CLI lanes unless all active tasks are fully isolated by app and file scope.**
**Codex cloud (legacy): max 2 parallel lanes.**

### Merge Policy

- **T3/docs/isolated UI:** merge on green
- **T2 isolated logic/refactor:** review diff, verify green, then merge
- **T1/migrations/runtime routing/shared contracts:** do not merge without explicit PM approval

### Required Checks Before Merge

At minimum run:
- `pnpm type-check`
- `pnpm test`
- issue-specific verification commands
- diff review for scope bleed, accidental deletions, and unrelated edits

### Stop Conditions

Do not continue blindly. Stop a lane and mark/block/reshape the issue if:
- issue scope is ambiguous
- Linear state conflicts with repo truth
- task requires a missing contract
- task overlaps another active lane
- baseline on main is failing
- issue depends on unresolved upstream work
- migration/runtime-risk work requires explicit PM approval

### Linear Hygiene

After every completed lane:
- update issue status
- attach PR link
- attach merge commit if merged
- note blockers if not completed
- create follow-on issues only when genuinely required by discovered repo truth

### Completion

When only blocked or non-executable issues remain, produce:
- list of completed issues
- merged PRs
- blocked issues and exact blocker
- reshaped issues created
- next recommended batch

## Codex Prompt Template

Every Codex task must include this packet. Do not give Codex vague work.

```
Work only this Linear issue.

You are not exploring the repo. You are executing a bounded task packet.

Required output:
1. implement only the scoped issue
2. touch only allowed files
3. do not modify forbidden files
4. run the required verification commands
5. summarize what changed
6. provide PR-ready summary
7. stop if scope is ambiguous or collides with active work

Task packet:
* Linear issue: <ID + title>
* Why it matters: <one short paragraph>
* Allowed files: <exact list>
* Forbidden files: <exact list or "all others">
* Acceptance criteria:
  * <item>
  * <item>
* Verification:
  * <command>
  * <command>
* Merge dependencies:
  * <none / depends on X>
* Rollback note:
  * <one short note>

Rules:
* no opportunistic refactors
* no unrelated cleanup
* no scope expansion
* no hidden dependency work unless explicitly included
* if blocked, stop and report the precise blocker
```

## Lane Discipline

This repo uses explicit lane separation.

**Claude lane** — default owner for:
- cross-cutting implementation
- independent verification
- governance / status reconciliation
- contracts and docs authority maintenance
- readiness decisions
- Linear / Notion sync
- orchestration of Codex lanes

**Codex CLI lane** (`owner: 'codex-cli'`) — default owner for:
- isolated runtime implementation
- isolated tests
- isolated endpoint implementation
- refactors with explicit file scope
- T3 bounded UI/docs work

**Codex cloud lane** (`owner: 'codex'`) — legacy, max 2 parallel

**Never do without explicit approval:**
- redefine architecture boundaries
- change canonical contracts materially
- widen the active milestone scope
- introduce new channels / product surfaces
- start the next milestone before the current one is formally closed
- activate Discord channels (game-threads, strategy-room, exclusive-insights live activation are explicitly out of scope)

If asked to verify, do not change runtime code.

## Batch Execution Pattern

### Claude agents (in Claude Code)
- Launch with `isolation: worktree` — each agent gets a clean isolated copy
- One agent per issue, one branch per issue, one PR per issue — no stacking
- Max 3 parallel Claude lanes
- **Merge on green without ceremony delay**
- Serial chains: launch the next agent on merge notification, not in advance

### Codex CLI lanes (separate terminal)
- Use `pnpm codex:dispatch -- --issue UTV2-XXX` to generate the task packet
- One Codex CLI session per issue — paste the packet, let it run
- Max 3 parallel Codex CLI lanes (only when file scope is 100% isolated)
- When Codex returns: `pnpm codex:receive -- --issue UTV2-XXX --branch <b> --pr <url>`
- `codex:receive` runs `pnpm type-check && pnpm test` — PASS required before merge
- **Claude Code is the ONLY merge authority — Codex CLI never merges directly**

## Architecture

> Full technical reference (confirmed against source files): `docs/CODEBASE_GUIDE.md`

### Package dependency graph

```
@unit-talk/contracts   ← pure types and domain contracts (no runtime deps)
@unit-talk/domain      ← pure business logic (imports contracts only)
@unit-talk/db          ← DB types, repository interfaces + implementations (imports contracts, domain)
@unit-talk/config      ← env loading only
@unit-talk/observability, events, intelligence  ← supporting packages
```

Apps import from packages but never from each other. The build is a TypeScript project references build.

### Data flow: submission → settlement

```
POST /api/submissions
  → submission-service: validate, create CanonicalPick (lifecycleState=validated)
  → promotion-service: evaluate best-bets eligibility, persist to pick_promotion_history
  → distribution-service: enqueue to distribution_outbox (gated — only qualified picks reach discord:best-bets)
  → worker polls outbox, claims row, calls delivery adapter (Discord embed)
  → on success: record distribution_receipt, transition pick validated→queued→posted, write audit_log
  → POST /api/picks/:id/settle
  → settlement-service: write settlement_records, transition posted→settled, write audit_log
```

### apps/api

The only canonical writer to the database. Handler layer coerces raw request bodies, delegates to controller layer, which calls services. Services are pure functions that receive repository bundles.

All servers fall back to in-memory repositories when Supabase credentials are absent — this is how unit tests run without a live DB.

### apps/worker

Polls `distribution_outbox`, claims rows, calls a `DeliveryAdapter` (Discord), records receipts. Typed `DeliveryOutcome` (`sent` | `retryable-failure` | `terminal-failure`). Circuit breaker per target.

### apps/operator-web

Read-only operator dashboard. No write surfaces. Provides JSON API endpoints consumed by Command Center.

### apps/command-center

Next.js 14 operator intelligence dashboard. Reads from operator-web, writes through API. No direct DB access. 4-workspace model (Research / Decision / Operations / Intelligence) — `WorkspaceSidebar` component ships in `src/components/WorkspaceSidebar.tsx` (CC Unification Phase 2, UTV2-427).

### apps/smart-form

Browser HTML intake form. Posts to `apps/api` via fetch. Source is hardcoded to `'smart-form'`. Body size capped at 64 KB.

### apps/discord-bot

Discord slash commands and member interaction. Reads from API. Does not write to DB directly.

### apps/alert-agent

Standalone process for line movement detection and notification routing.

### apps/ingestor

SGO feed ingest — populates `provider_offers` and `game_results`.

### @unit-talk/db

- `database.types.ts` — generated, never hand-edited
- `types.ts` — derives `*Record` types from generated types
- `repositories.ts` — repository interfaces
- `runtime-repositories.ts` — `InMemory*` and `Database*` implementations
- `lifecycle.ts` — `transitionPickLifecycle()` enforces the allowed state machine: `validated → queued → posted → settled` (and `→ voided` from most states)

### @unit-talk/contracts

Source of truth for all cross-package types. Includes promotion policies, scoring profiles, target registry, and member tier definitions.

## Promotion Gate

`evaluateAndPersistBestBetsPromotion()` in `apps/api/src/promotion-service.ts` evaluates five score components (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) from `pick.metadata.promotionScores`, runs them through per-policy weights from `@unit-talk/domain`, and persists to `pick_promotion_history`.

`distribution-service.ts` then enforces: picks not `qualified` or with `promotion_target != 'best-bets'` cannot reach `discord:best-bets`.

Approval and promotion are separate. Never collapse them conceptually in docs or code.

## Key Schema Facts

- `picks.status` = lifecycle state (not `lifecycle_state`)
- `pick_lifecycle` table (not `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to the primary entity (promotion history, outbox row, settlement record), not the pick id
- `audit_log.entity_ref` = pick id as text
- `submission_events.event_name` (not `event_type`)
- `settlement_records.corrects_id` = self-referencing FK for corrections; original row is never mutated

## Live Discord Targets

| Target | Channel ID | Status |
|---|---|---|
| `discord:canary` | `1296531122234327100` | Live — permanent control lane |
| `discord:best-bets` | `1288613037539852329` | Live — production channel |
| `discord:trader-insights` | `1356613995175481405` | Live — production channel |
| `discord:recaps` | `1300411261854547968` | Live — daily/weekly recap posts |
| `discord:exclusive-insights` | `1288613114815840466` | Code merged — live activation deferred |
| `discord:game-threads` | — | Not implemented — deferred |
| `discord:strategy-room` | — | Not implemented — deferred |

Do not activate deferred targets. Do not create new Discord channels.

## Governance

**Runtime leads docs.**

Rules:
- docs define intent
- runtime enforces truth
- tests prove runtime truth
- docs update only to match enforced reality

If something exists only in docs, say `docs-only`. If something exists only in config, say `config-only`. If something exists only in tests, say `test-only`.

## Verification Discipline

Independent verification should prefer live DB truth over runtime self-report.

**Preferred order:**
1. Repo CLI / API route / live DB query
2. operator surface
3. runtime/API response
4. worker log last

**Verification lane should check:**
- rows exist
- statuses match expected state
- lifecycle chain is correct
- audit rows exist
- prior artifacts were not mutated unintentionally
- no failed/dead_letter rows if the slice requires delivery health

If verifying, do not "fix while checking." Report truth first.

## Anti-Drift Rules

Watch for:
- duplicate templates
- stale week contracts
- generated `.js/.d.ts/.map` files under `src/`
- status docs disagreeing
- new docs without a clear purpose
- new product surfaces without a contract
- implementation starting before active-week contract exists

Every doc must serve one of: authority, contract, activation, proof, planning. If not, it probably should not exist.

Be aggressive about deletion: obsolete templates, superseded prompts, stale artifact indexes, duplicate proof files, dead generated source artifacts.

## Legacy Boundary

The old Unit Talk repo is reference-only.

Rules:
- no implicit truth import from legacy behavior
- no "it used to work this way" without a new v2 artifact or runtime proof
- any reused behavior must be explicitly re-ratified in v2

If legacy parity knowledge is needed, convert it into a bounded v2 reference artifact instead of relying on memory.

## Do Not Do These By Default

- do not widen the active milestone scope
- do not start M(N+1) before M(N) is formally closed
- do not add new channels without a contract
- do not activate deferred Discord channels
- do not add write surfaces to operator-web
- do not mutate settlement history
- do not change routing/product semantics casually
- do not create new packages unless clearly justified
- do not leave duplicate templates active
- do not use docs to claim runtime truth that is not yet enforced

## Preferred Verification Commands

```bash
pnpm test
pnpm test:db
pnpm type-check
pnpm build
pnpm lint
pnpm supabase:types
```

Run only what the active slice requires. Do not trigger broad expensive commands unnecessarily in verification-only sessions unless the contract requires them.

## Session Output Style

Prefer:
- exact files changed
- exact tests added
- exact verification results
- explicit done vs open
- explicit blockers
- explicit verdict

Avoid:
- vague optimism
- roadmap language when implementation truth is being requested
- inferring completion from intention

---

## Session Tools & Skill Discipline (MANDATORY)

### MCP Servers (Claude Code)

| Server | Purpose | When to use |
|---|---|---|
| Context7 | Live library docs | Any code touching Supabase, Discord.js, Next.js |
| Linear | Issue tracking | Reading/updating Linear during execution |
| Supabase | DB truth | Verification, schema, live state checks |
| GitHub | Repo ops | PRs, branches, merges |
| Notion | Docs authority | When doc truth is relevant |

Supabase project ref: `feownrheeefbcsehtsiw`

---

## Required Skills (Behavioral Contracts)

Claude must apply these behaviors when relevant:

### betting-domain
Use when:
- CanonicalPick
- scoring / promotionScores
- lifecycle
- CLV
- grading logic

Rules:
- Domain must remain PURE
- No DB, HTTP, or side effects
- Scoring must not drift from contracts

---

### outbox-worker
Use when:
- outbox polling
- delivery adapter
- retry / circuit breaker
- DeliveryOutcome

Rules:
- Exactly ONE DeliveryOutcome per attempt
- No swallowed errors
- No duplicate delivery paths
- Worker does NOT contain business logic

---

### system-state-loader
Use at:
- start of session
- after `/clear`

Rules:
- Load current system state before acting
- Do not assume state from memory
- Respect current milestone and blockers

---

## Core System Invariants

These must NEVER be violated:

1. Contract-first system
2. Fail-closed behavior (no silent fallback)
3. Postgres outbox is the ONLY queue
4. Domain logic is pure
5. Apps own side effects
6. No cross-app imports
7. No hallucinated architecture

---

## Context Management

- Run `/clear` at major task boundaries
- After `/clear`:
  - re-read this file
  - update Current Focus
  - run system-state-loader mentally
- If context degrades → clear immediately

---

## Execution Discipline (Always Active)

All tasks in Unit Talk must follow this execution model.

### Required Skills

Claude must apply these behaviors automatically:

- **betting-domain**
  - Domain logic must remain pure
  - No DB, HTTP, or side effects
  - Scoring, CLV, lifecycle must align with contracts

- **outbox-worker**
  - Exactly one DeliveryOutcome per attempt
  - No duplicate delivery paths
  - No swallowed errors
  - Worker contains no business logic

- **system-state-loader**
  - Load current system state before acting
  - Do not assume state
  - Respect milestone and blockers

---

### System Invariants (Never Violate)

- Contract-first system
- Fail-closed behavior (no silent fallback)
- Postgres outbox is the ONLY queue
- Domain logic is pure
- Apps own side effects
- No cross-app imports
- No duplicate delivery paths
- No swallowed errors
- No hallucinated architecture

---

### Execution Rules

- Prefer code over docs
- If uncertain → say "check actual implementation"
- Do not invent APIs or structure
- Fail closed rather than guessing
- Highlight violations when found

---

### Pre-Execution Thinking (Implicit)

Before acting, always determine:
- which skill applies
- which invariant is most at risk
