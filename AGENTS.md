# AGENTS.md — Unit Talk V2

This file is read by Codex before every task. Follow every rule here exactly.

---

## Workspace

- Active repo: this checkout (`/home/griff843/code/Unit-Talk-v2`)
- Legacy repo: `unit-talk-production` — **read-only reference only**. Never copy legacy behavior without explicit re-ratification in V2.

**Execution model:** the mission is Production Recovery (`docs/mission/intent.md`); the live plan is
`docs/mission/plan.md`. Execution state is the plan, the branches, the open PRs and the live runtime.
Linear is portfolio/history only — do not read it for execution state and do not update it.

Work arrives as a **work packet** (see Work Unit Contract below), runs on its own branch — in a
dedicated git worktree when it runs in parallel — and lands as a PR on green CI. The main checkout is
the control and merge checkout; do not branch-switch it to run parallel work. Merge, branch-refresh
and post-merge `main` sync stay serialized through `pnpm ops:merge-wrapper`.

**MCP usage:** Always use the OpenAI developer documentation MCP server (`openaiDeveloperDocs`) when
working with OpenAI APIs, ChatGPT Apps SDK, Codex, or related OpenAI docs without requiring an
explicit reminder.

---

## Package Manager + Commands

```bash
pnpm install           # install deps
pnpm test              # all unit tests — THIS IS THE TEST COMMAND
pnpm test:db           # DB smoke test (requires live Supabase credentials)
pnpm type-check        # TypeScript project-references type check
pnpm build             # compile all packages and apps
pnpm lint              # ESLint
pnpm verify            # env:check + lint + type-check + build + test — THE GATE COMMAND

# Run a single test file
tsx --test apps/api/src/submission-service.test.ts

# Regenerate Supabase DB types after a migration
pnpm supabase:types
```

**CRITICAL — test framework:**
- Tests use **`node:test`** and **`tsx --test`**
- Assertions use **`node:assert/strict`**
- **NO Jest. NO Vitest. NO describe/it/expect.** Use `test()`, `assert.strictEqual()`, `assert.deepStrictEqual()` etc.
- Every new test file must be discoverable by `tsx --test <path>`

---

## Monorepo Structure

```
apps/
  api/            ← only canonical DB writer; node:http server
  worker/         ← polls distribution_outbox, delivers to Discord
  discord-bot/    ← Discord slash commands + event handlers
  smart-form/     ← browser HTML intake form
  alert-agent/    ← alert detection + notification pass runner
  ingestor/       ← external results ingestion (SGO + league data)
packages/
  contracts/      ← pure types and domain contracts (no runtime deps)
  domain/         ← pure business logic (imports contracts only)
  db/             ← DB types, repository interfaces + implementations
  config/         ← env loading only
  observability/  ← logging, metrics (supporting)
  events/         ← event types (supporting)
  intelligence/   ← scoring/analysis (supporting)
  verification/   ← scenario registry + run history
```

**Package dependency DAG — never violate this:**
```
@unit-talk/contracts
  ↑
@unit-talk/domain
  ↑
@unit-talk/db
  ↑
apps/* (import from packages, NEVER from each other)
```

Apps must not import from other apps. Packages must not import from apps.

---

## TypeScript Build

This is a **TypeScript project references build**. Each package/app has a `tsconfig.json` with `references` pointing to its dependencies.

- Run `pnpm build` to compile all packages in correct dependency order
- Run `pnpm type-check` to check types without emitting
- Never hand-edit `dist/` or `*.js`/`*.d.ts`/`*.map` files under `src/` — these are build artifacts
- `packages/db/src/database.types.ts` is **generated** — never hand-edit it; run `pnpm supabase:types` after migrations

---

## Repository Pattern

All services use a **repository abstraction** with two implementations:

| Implementation | When used |
|---|---|
| `InMemory*Repository` | Unit tests — no live DB required |
| `Database*Repository` | Production — requires Supabase credentials |

Services receive a `RepositoryBundle` (or individual repos) and must work with either implementation. Never call Supabase directly from a service — always go through a repository interface.

When writing tests: use `InMemory*` repos. When writing DB implementations: implement the same interface as the InMemory version.

---

## Data Flow: Submission → Settlement

```
POST /api/submissions
  → submission-service: validate, create CanonicalPick (status=validated)
  → promotion-service: evaluate promotion eligibility, persist to pick_promotion_history
  → distribution-service: enqueue to distribution_outbox (gated)
  → worker polls outbox → claims row → calls DeliveryAdapter (Discord)
  → on success: record distribution_receipt, transition pick status, write audit_log
  → POST /api/picks/:id/settle
  → settlement-service: write settlement_records, transition to settled, write audit_log
```

---

## Key Schema Facts

Get these wrong and tests will fail or data will corrupt:

- `picks.status` = lifecycle state field name (NOT `lifecycle_state`)
- `pick_lifecycle` = table name (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to the primary entity (outbox row, settlement record, promotion history row) — **NOT** the pick id
- `audit_log.entity_ref` = pick id stored as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = self-referencing FK for corrections; original row is **never mutated**
- `audit_log` = immutable, append-only; enforced by DB trigger — never UPDATE or DELETE from it
- Pick lifecycle: `validated → queued → posted → settled` (or `→ voided` from most states)

---

## Environment Loading

- Load order: `local.env` → `.env` → `.env.example`
- No dotenv package — `@unit-talk/config` parses env files directly
- `local.env` and `.env` are gitignored (contain real credentials)
- `.env.example` is the template — add new env vars here when you add them to the app
- Supabase project ref: `zfzdnfwdarxucxtaojxm`

---

## Work Unit Contract — What Codex Owns

Codex receives a **work packet** (`docs/mission/packets/TEMPLATE.md`), not a Linear issue. The packet
is the whole contract: goal, scope, acceptance, and what not to touch. Everything Codex needs must be
in it — Codex does not read Linear, chat history, or a lane manifest.

The packet is delivered by `pnpm ops:codex-packet --packet <path> --cwd <isolated worktree>`, which
runs Codex in that worktree with
the packet as its task contract. There is no lane admission step.

Codex owns:

- runtime implementation (services, handlers, adapters)
- database migrations (written; merged only with Griff's approval)
- schema/type updates
- tests
- CI changes
- service wiring
- endpoint implementation
- repository implementations (InMemory + Database)

Codex does **not** own:

- `docs/mission/**` — the mission intent, spec index and plan are Claude/Griff-owned
- readiness decisions, or declaring the mission or a milestone done
- widening the packet's scope, or deciding that a different problem is the real one
  (report that instead — it is useful, but it is a plan change, and the plan is Claude's)

When the packet is done: `pnpm verify` green, PR open, report what was and was not achieved. Do not
close anything out; there is nothing to close.

---

## Parallelism

Parallel work runs in dedicated git worktrees, one work unit per branch per PR. Claude owns how much
runs in parallel and decides it from real constraints — overlapping files, serialized migrations, and
the merge mutex — not from a fixed quota.

Codex does not self-authorize additional parallel work. Do the packet you were given; if it needs to
be split, say so and return.

**Hard serialization rules that still hold:**
- Migrations merge one at a time. Never two migrations in one deploy.
- Merge, branch-refresh and post-merge `main` sync go through `pnpm ops:merge-wrapper` (merge mutex).
- Two changes to the same file do not run in parallel — they queue.

`docs/governance/CONCURRENCY_CONFIG.json` and `LANE_CONCURRENCY_POLICY.md` describe the legacy
lane-slot model. They remain in place for lanes that are still open and are not authority for new work.

---

## Reserved Surfaces — implement if the packet says so, but flag them

`docs/05_operations/RESERVED_RISK_SURFACES.json` is the machine-readable list of surfaces Griff
reserves. It is enforced at **merge** by `.github/workflows/merge-gate.yml` — not at the keyboard.

If your change touches one of these paths:

1. Do not silently widen the change beyond what the packet asked for.
2. State the surface, the production effect, and how it is reversed, in the PR body under
   `## Risk surfaces`.
3. Expect the PR to sit until Griff approves it. That is correct behavior, not a failure.

If the packet does **not** ask for a reserved-surface change and your work seems to require one,
stop and report what decision is needed. Leave the working tree clean.

The reserved surfaces are: production DDL and data deletion, member-delivery activation, secrets,
pricing/tier authority, production containment, and merge authority itself. Read the JSON for the
exact path globs — never re-derive the list from memory or from this file.

Beyond the reserved surfaces, these paths are high-consequence and warrant extra care, but they do
not require an approval artifact: `packages/contracts/src/**` (cross-package contracts),
`packages/domain/src/**` (pure — no I/O), `packages/db/src/lifecycle.ts` (lifecycle FSM),
`packages/db/src/repositories.ts` and `runtime-repositories.ts` (write authority),
`apps/api/src/distribution-service.ts` (routing/gating), `apps/api/src/auth.ts` (auth/RBAC).
`packages/db/src/database.types.ts` is generated — never hand-edit it; run `pnpm supabase:types`.

---

## Hard Rules — Never Do These

- **Never** install Jest, Vitest, Mocha, or any test runner. Use `node:test` + `tsx --test`.
- **Never** import from another app (e.g., `apps/api` must not import from `apps/worker`)
- **Never** hand-edit `packages/db/src/database.types.ts` — generated only
- **Never** activate a blocked Discord target (`discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`) — requires a written contract
- **Never** mutate `settlement_records` rows — corrections use `corrects_id`
- **Never** UPDATE or DELETE from `audit_log` — append-only
- **Never** create new packages without a clear justification
- **Never** widen the scope of a work packet beyond what it asks for
- **Never** skip `pnpm verify` — it is the gate; all PRs must pass it

---

## Live Discord Targets

| Target | Channel ID | Status |
|---|---|---|
| `discord:canary` | `1296531122234327100` | Live |
| `discord:best-bets` | `1288613037539852329` | Live |
| `discord:trader-insights` | `1356613995175481405` | **Blocked** |
| `discord:exclusive-insights` | `1288613114815840466` | **Blocked** |
| `discord:game-threads` | — | **Blocked** |
| `discord:strategy-room` | — | **Blocked** |

---

## Promotion Gate

`evaluateAndPersistBestBetsPromotion()` in `apps/api/src/promotion-service.ts` evaluates five components (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) from `pick.metadata.promotionScores`, runs them through `bestBetsPromotionPolicy` (minimumScore: 70.00), and persists to `pick_promotion_history`.

`distribution-service.ts` enforces: picks not `qualified` or with a wrong `promotion_target` cannot reach a live channel.

Approval and promotion are separate concepts. Never collapse them.

---

## Verification Gate

Before marking any task done, run:

```bash
pnpm verify
```

This runs: env:check + lint + type-check + build + test. All must pass. If any fail, fix before submitting.

**`pnpm test:db` requirements:** run it when the change touches DB read/write paths — changed files
include `supabase/migrations/**`, `packages/db/**`, or `apps/api/src/**-service.ts` — or when the
packet asks for runtime evidence. When in doubt, run it; it is non-destructive. Paste the output into
the PR body. Verification depth follows what the change risks, not a tier label.

---

## Codex Pre-PR Checklist

Before opening any PR, complete these in order:

1. **pnpm verify** — must be green. No exceptions.
2. **Scope check** — every file you changed must be within the packet's declared scope. Revert any
   scope bleed. If the work genuinely requires a file outside scope, say so in the PR body.
3. **Reserved-surface check** — run `pnpm ops:classify-diff`. It prints `authority: auto` or
   `authority: human` and names the surfaces; the policy behind it is
   `docs/05_operations/RESERVED_RISK_SURFACES.json`. If the diff classifies `human`, the PR still
   opens normally — it simply cannot merge until Griff approves it. Say which surface it touched in
   the PR body.
4. **No new `any` casts** — unless the existing code already uses them and the packet does not
   require typed fixes.
5. **Tests** — new runtime behavior requires new `node:test` tests. No test count decrease.
6. **Open the PR** with `gh pr create` using the body template below.

No Linear issue ID, no tier label and no lane manifest is required. Those belonged to the prior
execution primitive. An advisory R-level check
(`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`) still exists and may be useful on
lifecycle/domain paths, but it does not gate the merge.

### Forbidden actions (never do these in a PR)

1. Install Jest, Vitest, Mocha, or any test runner — use `node:test` + `tsx --test` only
2. Import from another app (`apps/api` must not import from `apps/worker`)
3. Hand-edit `packages/db/src/database.types.ts` — run `pnpm supabase:types`
4. Activate a blocked Discord target (`discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`)
5. Mutate `settlement_records` rows — corrections use `corrects_id`
6. UPDATE or DELETE from `audit_log` — append-only, enforced by DB trigger
7. Create new packages without explicit justification in the packet
8. Push directly to `main`, or merge your own PR past a red or missing required check

---

## Required PR Body Template

Every PR body must include these sections exactly:

```markdown
## Summary
<1-3 bullet points describing what changed and why>

## Files changed
<list of files modified and what each does>

## Verification
<paste last 20 lines of `pnpm verify` output>
<if the change touches DB read/write paths, paste `pnpm test:db` output too>

## Test coverage
<list new or updated test files and what scenario each covers>
<for a behavior change: name the test that fails if the change is reverted>

## Risk surfaces
<state whether the diff touches any surface in docs/05_operations/RESERVED_RISK_SURFACES.json>
<if none: "No reserved surface touched — merge authority is `auto` on green CI.">
<if any: name the surface and describe the production effect and how it is reversed>

## Merge order
State whether this PR must merge before or after any other currently open PR.
- If independent: "No open PR shares overlapping files — no merge dependency."
- If dependent: "Must merge after PR #NNN — that branch changes X which this PR imports."
```

---

## What a Good PR Looks Like

- Only touches files the packet's scope names
- Adds or updates tests in the same PR as the implementation
- All new tests use `node:test` + `node:assert/strict`
- `pnpm verify` passes
- No new `any` casts unless the existing code already uses them and the packet doesn't require typed fixes
- No new packages added without clear necessity
- Commit message says what changed and why, in conventional-commit form
  (e.g. `fix(api): reject submissions with an unresolvable capper identity`)
- If the diff touches a reserved surface, the PR body says so explicitly
