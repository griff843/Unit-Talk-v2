# Week 6 Execution Contract

## Objective

Week 6 exists to convert `discord:best-bets` from a governance-approved target into a runtime-governed target.

The goal is not merely to send a first real-channel post.

The goal is to:
- persist promotion decisions in canonical storage
- evaluate promotion in the runtime path
- prevent non-qualified picks from routing to `discord:best-bets`
- harden CI so the current runtime proof is enforced on every change
- tighten governance so Week 6 status can be answered from explicit repo authority

Week 6 is **not complete** until:
- runtime promotion integration is finished
- CI hardening is finished

`discord:best-bets` must **not** be activated as a real live lane before the runtime promotion gate exists.

## Required Deliverables

### 1. Promotion Persistence

Required work:
- add the following fields to the canonical `picks` table:
  - `approval_status`
  - `promotion_status`
  - `promotion_target`
  - `promotion_score`
  - `promotion_reason`
  - `promotion_version`
  - `promotion_decided_at`
  - `promotion_decided_by`
- generate updated Supabase types
- update `packages/db/src/types.ts` and repository contracts to expose the new fields

Binding rule:
- no runtime promotion decision may exist only in memory
- every Best Bets routing decision must be durable and queryable from the database

### 2. Runtime Evaluation Point

Required work:
- evaluate Best Bets promotion after canonical pick materialization and before any Best Bets outbox enqueue
- keep approval and promotion as separate stages in code
- ensure promotion evaluation uses the V1 board promotion evaluator from:
  - `packages/domain/src/promotion.ts`

Binding rule:
- approval into the canonical pipeline must not imply Best Bets routing

### 3. Routing Gate

Required work:
- create an explicit code path that blocks `discord:best-bets` enqueue unless:
  - `promotion_status = qualified` or `promoted`
  - `promotion_target = best-bets`
- keep `discord:canary` available as the control lane
- ensure the worker never becomes the place where picks are silently promoted

Binding rule:
- the gate must exist before any real `discord:best-bets` live activation

### 4. Override Persistence

Required work:
- persist operator override inputs for:
  - `force_promote`
  - `suppress_from_best_bets`
  - reason capture
- overrides must be durable, auditable, and visible to operator tooling
- override application must record:
  - actor
  - timestamp
  - reason
  - resulting promotion decision

Binding rule:
- operator override behavior may not remain a contract-only concept by the end of Week 6

### 5. Promotion Tests

Required work:
- add promotion-specific runtime tests covering:
  - approved but not qualified pick does not route to `discord:best-bets`
  - qualified pick routes to `discord:best-bets`
  - duplicate or capped board state suppresses promotion
  - operator `force_promote` allows routing
  - operator suppression blocks routing
  - promotion fields are persisted

Binding rule:
- Week 6 cannot close with promotion logic only described in docs

### 6. CI Hardening

Required work:
- update `.github/workflows/ci.yml` so CI requires:
  - `pnpm lint`
  - `pnpm type-check`
  - `pnpm build`
  - `pnpm test`
- add `pnpm test:db` as a required CI job when database credentials are available in CI
- if `pnpm test:db` cannot run in the current CI environment, add a clearly named blocking follow-up issue and document the exact missing secret/env requirement

Binding rule:
- Week 6 cannot close while tests remain optional in CI

### 7. Governance Tightening

Required work:
- create a single status source-of-truth file:
  - `docs/06_status/status_source_of_truth.md`
- create a docs authority map:
  - `docs/05_operations/docs_authority_map.md`
- add owner and ratified metadata to all contract docs under:
  - `docs/02_architecture/contracts/`
  - `docs/01_principles/system_context.md`
  - `docs/02_architecture/domain_model.md`
- define explicit program kill conditions in repo docs

Binding rule:
- governance ambiguity may not remain an unowned gap after Week 6

### 8. Settlement Planning Lock

Required work:
- ratify settlement scheduling and scope in repo docs
- assign an exact target week for settlement implementation
- define the first three settlement slices
- define acceptance criteria for the first posted-to-settled proof

Binding rule:
- Week 6 does not need settlement implementation
- Week 6 does require settlement planning to stop being undefined

## Freeze Rules

Until this contract is satisfied:
- do not activate real `discord:best-bets`
- do not widen live routing beyond `discord:canary`
- do not start `discord:game-threads`
- do not start `discord:strategy-room`
- do not begin settlement-heavy runtime implementation
- do not add new product surfaces unrelated to promotion/runtime hardening
- do not treat preview-through-canary as equivalent to a real production lane

## Acceptance Criteria

Week 6 is accepted only if all of the following are true:

### Promotion
- promotion fields exist in the live schema
- generated DB types reflect the promotion fields
- promotion evaluation happens in the runtime path
- non-qualified picks cannot route to `discord:best-bets`
- operator overrides are persisted and auditable

### Tests
- promotion-specific tests exist and pass
- `pnpm test` is required in CI
- `pnpm test:db` is either required in CI or explicitly blocked by documented CI secret/env constraints

### Governance
- `docs/06_status/status_source_of_truth.md` exists and is authoritative
- `docs/05_operations/docs_authority_map.md` exists and is authoritative
- contract docs have owner and ratified metadata
- explicit program kill conditions are documented

### Best Bets Promotion Readiness
- the real-channel promotion checklist can be run without hand-waving
- the runtime promotion gate exists before the config change
- the first real-channel post is still optional until the gate exists and CI hardening is done

## Non-Goals

Week 6 does not include:
- broad multi-channel rollout
- thread routing
- DM routing
- strategy-room activation
- game-thread activation
- settlement runtime implementation
- a full ranking/intelligence system beyond the V1 promotion gate
- replacing `discord:canary` as the permanent control lane

## Owners And Target Dates

### Codex

- promotion persistence
  - target date: 2026-03-21
- runtime evaluation point
  - target date: 2026-03-21
- routing gate
  - target date: 2026-03-21
- promotion tests
  - target date: 2026-03-21
- CI hardening
  - target date: 2026-03-21

### Claude

- docs authority map
  - target date: 2026-03-21
- status source-of-truth doc
  - target date: 2026-03-21
- contract owner/ratified metadata pass
  - target date: 2026-03-22
- explicit program kill conditions
  - target date: 2026-03-22
- settlement planning lock
  - target date: 2026-03-22

### Shared

- operator override persistence shape
  - target date: 2026-03-22
- final Week 6 acceptance review
  - target date: 2026-03-22

## Explicit Blockers

The following are blocking items for Week 6 closeout:
- promotion fields do not exist in the live schema
- runtime promotion evaluation is not wired into the submission/distribution path
- `discord:best-bets` can still be routed by approved-only picks
- operator overrides are not persisted
- promotion tests do not exist
- `pnpm test` is not enforced in CI
- status source-of-truth file does not exist
- docs authority map does not exist
- settlement week and first proof criteria remain undefined

## Rollback Conditions

### Rollback Of Week 6 Runtime Changes

If runtime promotion integration causes instability:
- remove the Best Bets routing gate from active use only after disabling `discord:best-bets` live routing
- revert the `UNIT_TALK_DISTRIBUTION_TARGETS` change so live routing returns to `discord:canary` only
- preserve persisted promotion data for investigation
- record the failure in:
  - `docs/06_status/system_snapshot.md`
  - Notion checkpoint
  - Linear Week 6 issue comments

### Rollback Of Real-Channel Promotion

If a real `discord:best-bets` post is attempted later and any of the following occur:
- outbox row enters `failed` or `dead_letter`
- worker health becomes `degraded` or `down`
- receipt is missing
- operator snapshot no longer shows healthy steady-state

Then:
- remove `discord:best-bets` from `UNIT_TALK_DISTRIBUTION_TARGETS`
- keep `discord:canary` active
- do not delete outbox rows
- preserve receipt, audit, and run evidence

## Week 6 Completion Rule

Week 6 must remain **in progress** until:
- runtime promotion integration is finished
- CI hardening is finished

Do not mark Week 6 complete before both conditions are true.
