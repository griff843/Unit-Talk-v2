# AGENTS.md — Unit Talk V2

This is the compact, always-loaded instruction set. Load deeper context only when the task requires
it. The assigned work packet remains the bounded implementation authority.

## Start with current state

Run `pnpm ops:brief -- --static` at session start and after context loss. Use full `pnpm ops:brief`
only for work that needs tracker, PR, runtime, database, or production truth.

Read mission documents progressively:

- Read `docs/mission/intent.md` and `docs/mission/spec.md` for product behavior, mission, readiness,
  governance, or operating-model decisions.
- Read relevant sections of `docs/mission/plan.md` only when the work packet or brief identifies a
  current-plan dependency. Claude owns this file; Codex does not edit it unless explicitly assigned.
- Never modify `docs/mission/intent.md` or redefine the mission.

For product-behavior changes, including backend behavior that changes what a product can do or
record, read the product intent and the contracts it indexes:

- Smart Form: `docs/03_product/smart-form/intent.md` and its indexed submission, sportsbook,
  live-offer, confidence, runtime-mode, and delivery-kill-switch contracts.
- Command Center: `apps/command-center/CLAUDE.md` and the canonical Command Center contract.
- Pipeline/grading/settlement/CLV: the applicable automated-grading and closing-line contracts.

Canonical contracts win over intent documents. Report disagreement; do not silently choose.

## Workspace and execution

- Repository: `/home/griff843/code/Unit-Talk-v2` (`C:\Dev\Unit-Talk-v2-main`).
- Legacy `C:\dev\unit-talk-production` is read-only reference; never copy behavior without V2
  re-ratification.
- The main checkout is control/merge only. Execute implementation in the worktree created or resumed
  by `pnpm ops:lane-start`; never branch-switch the main checkout for lane work.
- Concurrency authority is `docs/governance/CONCURRENCY_CONFIG.json`; never hard-code or infer caps.
  Runtime, migration, modeling, and data-canonical work classes are singletons.
- Merge, branch refresh, tracker completion, and lane closeout remain serialized by the merge mutex.
- Prefer OpenAI developer-docs MCP for OpenAI APIs/Codex and Linear MCP for Linear workflows; use repo
  CLI fallbacks only when MCP is unavailable.

## Package and test rules

```bash
pnpm install
pnpm test
pnpm type-check
pnpm build
pnpm lint
pnpm verify
pnpm test:db
pnpm exec tsx --test path/to/file.test.ts
```

- `pnpm verify` is the required final gate for normal lanes. The positively classified non-T1
  static branding exception below uses `pnpm verify:static` instead; no other exemption applies.
- Tests use `node:test`, `node:assert/strict`, and `tsx --test`. Never install or use Jest, Vitest,
  Mocha, `describe`, `it`, or `expect`.
- New runtime behavior requires focused tests, and every new test must run directly with
  `tsx --test <path>`.
- This is a TypeScript project-references build. Never hand-edit generated `dist/`, `*.js`, `*.d.ts`,
  or `*.map` artifacts under `src/`.

Live DB verification:

- T1 always requires `pnpm test:db`.
- T2/T3 require it when changed files include migrations, `packages/db/**`, or
  `apps/api/src/**-service.ts`; when uncertain, run it.

Static branding/presentation exception:

- `.github/workflows/ci.yml` qualifies only a complete, nonempty diff containing brand changes
  under `docs/03_product/brand/**`, `apps/smart-form/app/submit/components/BrandLogo.tsx`, or
  `apps/command-center/src/components/WorkspaceSidebar.tsx`, plus normal lane/proof metadata.
- A single known T2/T3 tier is required; T1, `proof-required`, missing/ambiguous tier, unknown diff,
  or any other file uses normal CI. Renames examine both source and destination paths.
- Qualified presentation-only work has no mandatory R1-R5, writable staging DB, or runtime proof.
  Its required `verify` context runs static verification, both affected apps' build/type-check,
  and `pnpm exec tsx --test scripts/ci/branding-components.test.ts` (isolated logo geometry/rendering).
- This does not exempt T1, runtime, DB, migration, API-service, or delivery changes, or alter their
  proof/approval requirements. See `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_BRANCH_PROTECTION.md`.

## Architecture boundaries

Dependency direction is strict:

```text
@unit-talk/contracts <- @unit-talk/domain <- @unit-talk/db <- apps/*
```

- Apps never import from other apps. Packages never import from apps.
- `packages/domain` is pure business logic with no I/O.
- Services use repository interfaces and must work with InMemory and Database implementations.
  Services never call Supabase directly.
- `apps/api` is the only canonical DB writer.
- Add no package without explicit issue justification.

Persistent-data invariants:

- Lifecycle column is `picks.status`; lifecycle table is `pick_lifecycle`.
- Lifecycle is `validated -> queued -> posted -> settled`, with allowed transitions to `voided`.
- `submission_events.event_name` is the event field.
- `audit_log.entity_id` points to the primary entity; `entity_ref` carries the pick ID as text.
- `audit_log` is immutable and append-only: never UPDATE or DELETE it.
- Settlement corrections insert a new row linked by `corrects_id`; never mutate the original.
- `packages/db/src/database.types.ts` is generated; regenerate with `pnpm supabase:types`.
- Env load order is `local.env` -> `.env` -> `.env.example`; add new variables to `.env.example`.

Use the relevant repository skill for detailed domain, lifecycle, promotion, delivery, Smart Form,
operator-surface, migration, or DB-proof invariants. Do not load unrelated skills.

## Scope and ownership

Codex owns bounded runtime implementation, endpoints, service wiring, repository implementations,
schema/type updates, migrations, tests, and CI changes.

Codex does not own general documentation, program/status files, readiness decisions, orchestration,
proof templates, or tracker/Notion synchronization. Do not edit `docs/**` unless acceptance criteria
explicitly require a named proof or document. Never widen the issue beyond its acceptance criteria.

## Tier C — stop and report before editing

These paths require PM plan approval and PM merge approval. If the assigned task does not explicitly
authorize them, stop with the exact decision needed and leave the tree clean:

- `supabase/migrations/**`
- `packages/contracts/src/**`
- `packages/domain/src/**`
- `packages/db/src/lifecycle.ts`
- `packages/db/src/repositories.ts`
- `packages/db/src/runtime-repositories.ts`
- `packages/db/src/database.types.ts` (generated; never hand-edit)
- `apps/api/src/distribution-service.ts`
- `apps/api/src/auth.ts`
- `apps/worker/**`

Never activate blocked Discord targets. Currently blocked: `discord:trader-insights`,
`discord:exclusive-insights`, `discord:game-threads`, and `discord:strategy-room`. Approval and
promotion remain separate concepts; never collapse them.

## Verification and PR closeout

Before a PR:

1. Inspect `docs/05_operations/r1-r5-rules.json` for rules matching changed paths and satisfy every
   required artifact.
2. Run `pnpm verify` (or the qualified static branding gate above), then
   `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` until PASS.
3. Confirm every changed file is in scope, no test count decreased, and no new `any` cast was added
   without an existing-code justification.
4. Use a commit message referencing the repository work ID or Linear ID when one exists.
5. Open the PR using `.github/pull_request_template.md`; paste verification and R-level evidence.
6. Apply the actual issue tier label immediately: `gh pr edit <PR> --add-label "tier:T#"`.

Never claim completion with a red gate. Do not fix unrelated baseline debt while checking; report it
with precise evidence and keep the assigned scope bounded.
