# Unit Talk V2 — Current System Truth

> **SUPERSEDED 2026-03-31.** This file is a historical snapshot from 2026-03-24. The current system truth authority is `docs/06_status/PROGRAM_STATUS.md`. Do not use this file for current-state decisions.

> Generated: 2026-03-24. Grounded in live repo inspection.
> This is a handoff document for AI assistants (ChatGPT, Claude, etc.) entering cold sessions.
> All values are from actual source files, not inferred from history or docs alone.

---

## What This System Is

Unit Talk V2 is a **sports betting pick lifecycle platform**. It receives pick submissions, evaluates them for promotion eligibility, delivers qualified picks to Discord channels, and records settlement outcomes. The V2 codebase is a clean-room rebuild — no legacy code is in the runtime path.

---

## Platform State (2026-03-24)

| Field | Value |
|-------|-------|
| Tests | **534/534 passing** — deterministic across consecutive runs |
| `pnpm verify` | Exits 0 — all 5 gates pass (env:check, lint, type-check, build, test) |
| Full lifecycle | **VERIFIED** — submit → DB → distribute → Discord → settle → downstream truth |
| Live channels | `discord:canary` (permanent), `discord:best-bets` (live), `discord:trader-insights` (live) |
| Smart Form | Port 4100 — `predev` hook kills zombie before `next dev` starts |

---

## Apps (5)

| App | Port | Purpose | Key Entry |
|-----|------|---------|-----------|
| `apps/api` | 4000 | Canonical write API — submissions, settlement | `src/server.ts` |
| `apps/worker` | — | Distribution outbox poller → Discord delivery | `src/distribution-worker.ts` |
| `apps/operator-web` | 3000 | Read-only operator dashboard | `src/server.ts` |
| `apps/smart-form` | 4100 | Browser bet intake form (Next.js) | `app/submit/page.tsx` |
| `apps/discord-bot` | — | (Exists, not active in current sprint) | — |

---

## Packages (dependency order, low → high)

| Package | Purpose |
|---------|---------|
| `@unit-talk/contracts` | Pure types and policy constants — zero runtime deps |
| `@unit-talk/domain` | Pure business logic — probability, devig, promotion gates, settlement downstream |
| `@unit-talk/db` | DB types (generated), repository interfaces + implementations, lifecycle enforcement |
| `@unit-talk/config` | Environment loading from `local.env` / `.env` / `.env.example` |
| `@unit-talk/observability` | Logging/tracing support |
| `@unit-talk/events` | Event type definitions |
| `@unit-talk/intelligence` | AI/analysis utilities |
| `@unit-talk/verification` | Scenario registry, run history, archive (V2-native) |

Apps import from packages. Packages never import from apps. Apps never import from each other.

---

## Data Flow: Submission → Settlement

```
POST /api/submissions
  → submission-service: validate → CanonicalPick (status=validated)
  → evaluateAllPoliciesEagerAndPersist(): evaluate best-bets AND trader-insights in one pass
      → routes to highest-priority qualified target: trader-insights > best-bets > suppressed
      → persists pick_promotion_history (winner + loser rows)
      → auto-enqueues to distribution_outbox if qualified
  → worker polls outbox, claims row, calls Discord delivery adapter
  → on success: record distribution_receipt, transition validated→queued→posted, write audit_log
  → POST /api/picks/:id/settle
  → settlement-service: write settlement_records, transition posted→settled, write audit_log
  → computeSettlementDownstreamBundle(): effective result, correction depth, ROI, loss attribution
```

---

## Promotion Gate Summary

**Gate function:** `evaluatePromotionEligibility()` in `packages/domain/src/promotion.ts`

15 gates evaluated in order. First failure returns non-qualified status:

1. Operator suppress override
2. Approval status must be `approved`
3. Required canonical fields present
4. Pick not stale
5. Within posting window
6. Market still valid
7. Not risk-blocked
8. No duplicate board exposure
9. `perSlate` cap not exceeded (cap: 5)
10. `perSport` cap not exceeded (cap: 3)
11. `perGame` cap not exceeded (cap: 1)
12. Confidence floor — **only applies when `pick.confidence !== undefined`** (floor: 0.6). Picks without confidence (Smart Form V1, manual submissions) bypass this gate.
13. Edge score meets minimum
14. Trust score meets minimum
15. Total weighted score meets minimum

**Board state query** filters to `status IN ('validated', 'queued', 'posted')` — settled/voided picks do NOT count toward caps.

---

## Promotion Policies (from `packages/contracts/src/promotion.ts`)

### Best Bets
```
minimumScore:    70
minimumEdge:     0
minimumTrust:    0
confidenceFloor: 0.6
boardCaps:       { perSlate: 5, perSport: 3, perGame: 1 }
version:         'best-bets-v1'
```

### Trader Insights
```
minimumScore:    80
minimumEdge:     85
minimumTrust:    85
confidenceFloor: 0.6
boardCaps:       { perSlate: 5, perSport: 3, perGame: 1 }
version:         'trader-insights-v1'
```

**Priority:** Trader Insights wins when a pick qualifies for both. Pick is routed exclusively to one target.

---

## Score Weights (from `packages/contracts/src/promotion.ts`)

| Component | Weight |
|-----------|--------|
| edge | 35% |
| trust | 25% |
| readiness | 20% |
| uniqueness | 10% |
| boardFit | 10% |

**Score resolution priority** (from `apps/api/src/promotion-service.ts`):
1. Explicit `pick.metadata.promotionScores.<field>` (operator-provided)
2. Domain analysis result (if `pick.confidence` and `pick.odds` both present)
3. Static fallback: edge/trust → `normalizeConfidenceForScoring(pick.confidence)`, readiness → 80, uniqueness → 80, boardFit → 75

**Smart Form V1 score:** Always 61.5 (no confidence → no domain analysis → static fallbacks only: 50×0.35 + 50×0.25 + 80×0.20 + 80×0.10 + 75×0.10 = 17.5 + 12.5 + 16 + 8 + 7.5 = 61.5). This is a fallback artifact, not a quality signal.

---

## Known System Findings (as of 2026-03-24)

| Finding | Status | Detail |
|---------|--------|--------|
| Smart Form V1 missing `confidence` field | PARTIALLY RESOLVED | Picks bypass confidence floor, score 61.5, are correctly suppressed at score gate (61.5 < 70). Land in manual/capper lane. Promotion-eligibility requires scoring rebuild. |
| Board caps saturated by test-run picks | RESOLVED | `getPromotionBoardState` now filters to `status IN ('validated','queued','posted')`. Settled/voided picks excluded. |
| Catalog endpoint used wrong repo | CLOSED | `createDatabaseRepositoryBundle` now uses `InMemoryReferenceDataRepository(V1_REFERENCE_DATA)` — V2 has no ref-data tables. |
| Smart Form zombie process on port 4100 | CLOSED | `predev` hook kills port 4100 before `next dev` starts (`scripts/kill-port.mjs`). |
| Enqueue gap | VERIFIED CLOSED | `evaluateAllPoliciesEagerAndPersist()` auto-enqueues qualified picks. `outboxEnqueued:true` in API response. |

---

## Test Runner Architecture

6 bounded groups, chained with `&&` (fail-closed):

| Script | Files | Surface |
|--------|-------|---------|
| `pnpm test:apps` | 7 | apps/api + apps/worker + apps/operator-web |
| `pnpm test:verification` | 4 | packages/verification |
| `pnpm test:domain-probability` | 6 | domain/probability + domain/outcomes-core |
| `pnpm test:domain-features` | 9 | domain/features + domain/models |
| `pnpm test:domain-signals` | 6 | domain/signals + bands + calibration + scoring |
| `pnpm test:domain-analytics` | 8 | domain/outcomes + market + eval + edge + rollups + system-health + risk + strategy |

No Jest, no Vitest — `node:test` + `tsx --test`. No more than 9 files per group (Windows stack exhaustion fix).

---

## Key Schema Facts

- `picks.status` = lifecycle state (NOT `lifecycle_state`)
- `pick_lifecycle` table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (promotion history row, outbox row, settlement record) — NOT the pick_id
- `audit_log.entity_ref` = pick_id as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = self-referencing FK for corrections; original row is never mutated
- `pick_promotion_history` = history-only — one row per policy evaluation
- `distribution_outbox.idempotency_key` = deduplication key
- `distribution_receipts.channel` = target channel string (`discord:best-bets`, etc.)

---

## Environment

- DB: Supabase project `feownrheeefbcsehtsiw`
- Env files: `local.env` (gitignored, real creds) > `.env` > `.env.example`
- No dotenv package — `@unit-talk/config` parses env files directly
- Test runner: `node:test` + `tsx --test` (no Jest/Vitest)
- Package manager: `pnpm@10.29.3`
- Platform: Windows 11 (all commands use Unix syntax via bash)
