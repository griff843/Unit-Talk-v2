# Unit Talk V2 — Cold-Session AI Handoff

> This doc is written for an AI assistant (ChatGPT, Claude, Gemini, etc.) entering a session without prior context.
> It is a condensed, opinionated summary of current reality. Start here, then read the other files in this folder for details.

---

## What Is This Repo?

**Unit Talk V2** is a TypeScript monorepo for a sports betting pick lifecycle platform. It takes pick submissions, evaluates them for promotion eligibility using a 15-gate rule engine, delivers qualifying picks to Discord channels, and records settlement outcomes.

It is a **clean-room rebuild** — the old Unit Talk codebase exists at `C:\dev\unit-talk-production` as reference-only. Do not import logic from it. Any reused behavior must be re-ratified in V2 artifacts.

---

## Current State (2026-03-24)

- **534/534 tests passing**
- All build gates pass (`pnpm verify` exits 0)
- Full pick lifecycle is operational end-to-end: submit → DB → promote → distribute → Discord → settle
- Three Discord channels are live: `canary`, `best-bets`, `trader-insights`
- Smart Form V1 picks score 61.5 (fallback — not a quality signal) and are suppressed at the score gate

---

## The 5 Apps

| App | Purpose |
|-----|---------|
| `apps/api` (port 4000) | Write API: submit picks, settle picks |
| `apps/worker` | Distribution outbox poller → delivers to Discord |
| `apps/operator-web` (port 3000) | Read-only operator dashboard |
| `apps/smart-form` (port 4100) | Browser intake form (Next.js) |
| `apps/discord-bot` | Not active |

---

## The 8 Packages

```
@unit-talk/contracts    ← types and policy constants (zero deps)
@unit-talk/domain       ← pure business logic (imports contracts only)
@unit-talk/db           ← DB types, repositories, lifecycle enforcement
@unit-talk/config       ← env loading
@unit-talk/observability, events, intelligence  ← supporting
@unit-talk/verification ← scenario registry + run history
```

Apps import packages. Packages never import apps. Apps never import each other.

---

## Key Architectural Facts

### Pick submission → promotion → distribution

1. `POST /api/submissions` → `processSubmission()`:
   - Validates and persists pick (status = `validated`)
   - Runs `evaluateAllPoliciesEagerAndPersist()` — evaluates both best-bets AND trader-insights simultaneously
   - Routes to highest-priority qualifying target (trader-insights > best-bets)
   - Auto-enqueues to `distribution_outbox` if qualified
2. Worker polls outbox, claims row, delivers to Discord, transitions pick `validated → queued → posted`
3. `POST /api/picks/:id/settle` → `settlement-service` → transitions to `settled`

### Promotion gate

15 gates in order. Gate 12 (confidence floor) only applies when `pick.confidence !== undefined`. Picks without confidence bypass this gate and are evaluated on their score.

Smart Form V1 has no confidence field → scores 61.5 → suppressed at gate 15 (score < 70 threshold).

### Score weights
- edge: 35%, trust: 25%, readiness: 20%, uniqueness: 10%, boardFit: 10%
- Best Bets minimum: 70; Trader Insights minimum: 80 (also needs edge ≥ 85, trust ≥ 85)

### Board state
- Board caps: 5 per slate, 3 per sport, 1 per game
- Board state query filters to `status IN ('validated', 'queued', 'posted')` — settled/voided do NOT count

---

## Critical Naming Facts (very common mistakes)

| Correct | Incorrect |
|---------|-----------|
| `picks.status` | `picks.lifecycle_state` or `picks.state` |
| `pick_lifecycle` (table) | `pick_lifecycle_events` |
| `audit_log.entity_id` = promotion history / outbox / settlement row ID | `entity_id` ≠ pick_id |
| `audit_log.entity_ref` = pick_id (as text) | |
| `submission_events.event_name` | `event_type` |
| `settlement_records.corrects_id` = correction pointer | original row is never mutated |

---

## Live Discord Channels

| Target | Channel ID | Status |
|--------|-----------|--------|
| `discord:canary` | `1296531122234327100` | LIVE — permanent |
| `discord:best-bets` | `1288613037539852329` | LIVE — production |
| `discord:trader-insights` | `1356613995175481405` | LIVE — production |
| `discord:exclusive-insights` | — | BLOCKED |
| `discord:game-threads` | — | BLOCKED — no thread routing |
| `discord:strategy-room` | — | BLOCKED — no DM routing |

**Do not activate blocked channels without a T1 contract.**

---

## What Does Not Exist in V2

- Tier concepts (S/A/B/C/D) — no tier classification
- `discord:free-picks` — not in approved target map
- Automated settlement (`source === 'feed'` throws 409)
- Old lifecycle stages (PICK_SUBMITTED, etc.)
- `pick_lifecycle_events` table (correct: `pick_lifecycle`)
- RLS — deferred, not rejected

---

## Governance Rules

1. `docs/06_status/PROGRAM_STATUS.md` is the **canonical program status** — it wins on conflict.
2. Every sprint has a tier: **T1** (high risk — needs contract + proof + verification), **T2** (medium), **T3** (low).
3. Any change to live Discord routing is an **automatic T1 trigger**.
4. Any DB migration is an **automatic T1 trigger**.
5. Runtime leads docs — if code says X and a doc says Y, X is truth.
6. Do not start work without checking whether an active contract exists.

---

## Test Commands

```bash
pnpm test              # all 534 tests
pnpm verify            # env:check + lint + type-check + build + test
pnpm type-check        # TypeScript check
pnpm build             # compile all

# Run a single file:
tsx --test apps/api/src/promotion-edge-integration.test.ts

# DB smoke test (requires live Supabase creds):
pnpm test:db
```

No Jest. No Vitest. Uses `node:test` + `tsx --test`. Assertions use `node:assert/strict`.

---

## Where to Look for Specific Things

| Question | Where to look |
|----------|--------------|
| What is the current test count / gate status? | `docs/06_status/PROGRAM_STATUS.md` |
| What are the promotion rules? | `packages/domain/src/promotion.ts` (code), `docs/discord/pick_promotion_interim_policy.md` (policy) |
| What Discord channels are live? | `docs/06_status/PROGRAM_STATUS.md § Live Routing` |
| What is the pick lifecycle? | `packages/db/src/lifecycle.ts` |
| What does a canonical submission look like? | `packages/contracts/src/submission.ts` |
| What score weights are used? | `packages/contracts/src/promotion.ts` |
| What DB tables exist? | `packages/db/src/database.types.ts` (generated) |
| What migrations are applied? | `supabase/migrations/` (8 files) |
| What is the next planned work? | `docs/06_status/PROGRAM_STATUS.md § Next Milestone` |

---

## More Detail

See the other files in `docs/ai_context/v2_truth_pack/`:
- `CURRENT_SYSTEM_TRUTH.md` — platform overview + scoring details
- `REPO_MAP.md` — directory layout + key file paths
- `PICK_LIFECYCLE_TRUTH.md` — lifecycle states, transitions, DB schema
- `DISCORD_STATE_TRUTH.md` — channel state, routing gates, embed specs
- `LAUNCH_BLOCKERS.md` — blocked channels, open work, candidate queue
- `CANONICAL_DOC_INDEX.md` — every authority doc and its role
