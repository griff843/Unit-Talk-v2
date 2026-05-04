# AGENTS.md — Unit Talk V2

This file is read by Codex before every task. Follow every rule here exactly.

---

## Workspace

- Active repo: `C:\Dev\Unit-Talk-v2-main` (this repo)
- Legacy repo: `C:\dev\unit-talk-production` — **read-only reference only**. Never copy legacy behavior without explicit re-ratification in V2.

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
- Supabase project ref: `feownrheeefbcsehtsiw`

---

## Lane Discipline — What Codex Owns

Codex is the **implementation lane**. You own:

- runtime implementation (services, handlers, adapters)
- database migrations
- schema/type updates
- tests
- CI changes
- service wiring
- endpoint implementation
- repository implementations (InMemory + Database)

**Codex does NOT own:**
- docs in `docs/` (Claude lane) — do not create or edit docs files unless an AC explicitly requires a specific doc as proof
- `PROGRAM_STATUS.md`, `ISSUE_QUEUE.md`, `status_source_of_truth.md` — Claude lane only
- readiness decisions, closeout artifacts, proof templates
- Linear / Notion syncing

---

## Hard Rules — Never Do These

- **Never** install Jest, Vitest, Mocha, or any test runner. Use `node:test` + `tsx --test`.
- **Never** import from another app (e.g., `apps/api` must not import from `apps/worker`)
- **Never** hand-edit `packages/db/src/database.types.ts` — generated only
- **Never** activate a blocked Discord target (`discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`) — requires a written contract
- **Never** mutate `settlement_records` rows — corrections use `corrects_id`
- **Never** UPDATE or DELETE from `audit_log` — append-only
- **Never** create new packages without a clear justification
- **Never** widen the scope of an issue beyond its acceptance criteria
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

**`pnpm test:db` requirements:**
```bash
pnpm test:db
```
T1 issues ALWAYS require `pnpm test:db` regardless of whether they explicitly touch the DB layer.
T2/T3 issues: run `pnpm test:db` only if changed files include `supabase/migrations/**`, `packages/db/**`, or `apps/api/src/**-service.ts`. When in doubt, run it — it's non-destructive.

---

## Codex Pre-PR Checklist

Before opening any PR, complete all 7 steps in order:

1. **R-level lookup** — open `docs/05_operations/r1-r5-rules.json`, identify which rules match your changed file paths, and confirm all `artifactRequirements[]` are satisfied. If any required artifact is absent, produce it or document why it is not applicable.
2. **pnpm verify** — must be green. No exceptions.
   Run `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`.
   If it prints FAIL, generate the missing artifacts from the NEXT_ACTION_COMMANDS output, then re-run until PASS.
   Paste the final PASS output into the PR body under `## R-level compliance`.
3. **Scope check** — every file you changed must be within the issue's acceptance criteria. Revert any scope bleed.
4. **No new `any` casts** — unless the existing code already uses them and the issue does not require typed fixes.
5. **Tests** — new runtime behavior requires new `node:test` tests. No test count decrease.
6. **Commit message** — must reference the Linear issue ID (e.g., `feat(api): UTV2-115 fail-closed runtime mode`).
7. **Tier label** — after opening the PR with `gh pr create`, immediately run:
   ```bash
   gh pr edit <PR-URL-or-number> --add-label "tier:T2"
   ```
   Replace `T2` with the actual tier from the Linear issue labels. Never skip this step — tier-label-check CI will block the merge gate.

### Forbidden actions (never do these in a PR)

1. Install Jest, Vitest, Mocha, or any test runner — use `node:test` + `tsx --test` only
2. Import from another app (`apps/api` must not import from `apps/worker`)
3. Hand-edit `packages/db/src/database.types.ts` — run `pnpm supabase:types`
4. Activate a blocked Discord target (`discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`)
5. Mutate `settlement_records` rows — corrections use `corrects_id`
6. UPDATE or DELETE from `audit_log` — append-only, enforced by DB trigger
7. Create new packages without explicit justification in the issue AC

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

## R-level compliance
<which rules in r1-r5-rules.json were triggered by the changed paths>
<for each triggered rule: list required[] levels and whether artifacts are present>
<if no runtime paths triggered: write "N/A — no lifecycle/domain/strategy/UI paths touched">

## Test coverage
<list new or updated test files and what scenario each covers>

## Merge order
State whether this PR must merge before or after any other currently open PR.
- If independent: "No open lanes share overlapping files — no merge dependency."
- If dependent: "Must merge after PR #NNN (UTV2-###) — that lane changes X which this PR imports."
```

---

## What a Good PR Looks Like

- Only touches files relevant to the issue's acceptance criteria
- Adds or updates tests in the same PR as the implementation
- All new tests use `node:test` + `node:assert/strict`
- `pnpm verify` passes
- No new `any` casts unless the existing code already uses them and the issue doesn't require typed fixes
- No new packages added without clear necessity
- No docs files modified unless the AC explicitly requires it
- Commit message references the Linear issue ID (e.g., `feat(api): UTV2-115 fail-closed runtime mode`)
