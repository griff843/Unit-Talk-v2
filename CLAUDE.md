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

## Start-of-Session Checklist

Before doing any work, read these in order:

1. `docs/06_status/status_source_of_truth.md` ← wins on conflict
2. `docs/06_status/current_phase.md`
3. `docs/06_status/next_build_order.md`
4. active week contract in `docs/05_operations/`
5. `docs/05_operations/docs_authority_map.md`

Then answer:
- What is the current active week/slice?
- What is in scope?
- What is explicitly out of scope?
- Is this an implementation lane or a verification/governance lane?

If any of those are unclear, stop and resolve before making changes.

## Lane Discipline

This repo uses explicit lane separation.

**Codex lane** — default owner for:
- runtime implementation
- migrations
- schema/type updates
- tests
- CI changes
- service wiring
- endpoint implementation

**Claude lane** — default owner for:
- independent verification
- proof templates
- rollback/failure templates
- weekly closeout artifacts
- docs authority maintenance
- status updates after proof
- anti-drift audits
- readiness decisions
- Linear / Notion sync

**Never do without explicit approval:**
- redefine architecture boundaries
- change canonical contracts materially
- widen the active week scope
- introduce new channels / product surfaces
- start the next week before the current one is formally closed

If asked to verify, do not change runtime code.

## Batch Execution Pattern

When the PM authorizes parallel execution of multiple codex-lane issues:

- Launch agents with `isolation: worktree` — each agent gets a clean isolated copy
- One agent per issue, one branch per issue, one PR per issue — no stacking
- **Merge on green CI without ceremony delay.** Do not hold PRs waiting for a full batch to complete — merge each as it lands
- Serial chains (issues with dependencies): launch the next agent on merge notification, not in advance
- When Codex is available, route codex-lane issues to Codex directly — this pattern is for Codex-offline or explicit PM batch authorization only

**Operator-web bottleneck:** Issues that share `apps/operator-web/src/server.ts` must land sequentially. Preferred order when all are in scope: route modules (UTV2-127) → target registry (UTV2-129) → pagination (UTV2-131) → exposure tracking (UTV2-134).

## Architecture

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

The only canonical writer to the database. Routes: `POST /api/submissions`, `POST /api/picks/:id/settle`, `GET /health`. Handler layer coerces raw request bodies, delegates to controller layer, which calls services. Services are pure functions that receive repository bundles.

All servers fall back to in-memory repositories when Supabase credentials are absent — this is how unit tests run without a live DB.

### apps/worker

Polls `distribution_outbox`, claims rows, calls a `DeliveryAdapter` (Discord), records receipts. The core logic is in `distribution-worker.ts` and is adapter-agnostic.

### apps/operator-web

Read-only operator dashboard. No write surfaces. `createOperatorSnapshotProvider()` in `server.ts` makes parallel Supabase queries on every request — no caching. `createSnapshotFromRows()` is pure and is what tests use.

Routes:
- `GET /`
- `GET /health`
- `GET /api/operator/snapshot`
- `GET /api/operator/picks-pipeline`

### apps/smart-form

Browser HTML intake form. Posts to `apps/api` via fetch. Source is hardcoded to `'smart-form'`. Body size capped at 64 KB.

### @unit-talk/db

- `database.types.ts` — generated, never hand-edited
- `types.ts` — derives `*Record` types from generated types
- `repositories.ts` — repository interfaces
- `runtime-repositories.ts` — `InMemory*` and `Database*` implementations
- `lifecycle.ts` — `transitionPickLifecycle()` enforces the allowed state machine: `validated → queued → posted → settled` (and `→ voided` from most states)

### @unit-talk/contracts

Source of truth for all cross-package types. `promotionTargets` is currently `['best-bets']` only unless a later week explicitly expands it.

## Promotion Gate

`evaluateAndPersistBestBetsPromotion()` in `apps/api/src/promotion-service.ts` evaluates five score components (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) from `pick.metadata.promotionScores`, runs them through `bestBetsPromotionPolicy` (minimumScore: 70.00) from `@unit-talk/domain`, and persists to `pick_promotion_history`.

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
| `discord:trader-insights` | `1356613995175481405` | Blocked — activation contract required |
| `discord:exclusive-insights` | `1288613114815840466` | Blocked |
| `discord:game-threads` | — | Blocked — thread routing not implemented |
| `discord:strategy-room` | — | Blocked — DM routing not implemented |

Do not activate blocked targets without a written and ratified contract.

## Governance

Development follows a weekly contract cadence.

Before starting implementation:
- active contract must exist in `docs/05_operations/`
- `status_source_of_truth.md` wins on conflict
- `next_build_order.md` defines sequence
- `docs_authority_map.md` defines authority tiers

**Runtime leads docs.**

Rules:
- docs define intent
- runtime enforces truth
- tests prove runtime truth
- docs update only to match enforced reality

If something exists only in docs, say `docs-only`. If something exists only in config, say `config-only`. If something exists only in tests, say `test-only`.

### Weekly close sequence

After all checks pass:
1. update `system_snapshot.md`
2. update `status_source_of_truth.md`
3. update `current_phase.md`
4. update `active_roadmap.md`
5. update `next_build_order.md`
6. update Linear
7. update Notion checkpoint
8. update Rebuild Home

Do not mark a week closed before proof and independent verification are complete.

## Verification Discipline

Independent verification should prefer live DB truth over runtime self-report.

**Preferred order:**
1. Supabase MCP / live DB query
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

- do not widen the active week scope
- do not start Week N+1 work before Week N is formally closed
- do not add new channels without a contract
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
