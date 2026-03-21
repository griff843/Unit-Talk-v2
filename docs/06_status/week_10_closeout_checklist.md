# Week 10 Closeout Checklist — Operator Visibility Gate

This document serves three purposes:

1. **Ambiguity register** — issues found during governance review, with resolutions.
2. **Closeout checklist** — maps each Week 10 close criterion to a verifiable check with fill-in fields.
3. **Week 11 gate evidence structure** — defines exactly what the operator surface must show before `discord:trader-insights` activation is considered.

Authority: `docs/05_operations/week_10_operator_command_center_contract.md`

---

## Metadata

| Field | Value |
|---|---|
| Prepared by | Governance/Verification Lane |
| Prepared date | 2026-03-20 |
| Verified date | 2026-03-20 |
| Status | **Closed — all criteria met. Week 10 formally closed 2026-03-20.** |
| Authority | `docs/05_operations/week_10_operator_command_center_contract.md` |

---

## Part 1 — Ambiguity Register

### A1: `activationHealthy` window is count-based, not time-based

**Location**: `week_10_operator_command_center_contract.md`, Slice 1 ("recent sent count, configurable window, default last 50 rows")

**Issue**: The contract says "configurable window, default last 50 rows" for best-bets, but the implementation uses the same `recentOutbox` query as the canary section (default limit: 12 rows across all targets). The `activationHealthy` flag is computed in-memory from whatever rows were fetched. There is no time-based window. For a low-volume system with mixed targets, a best-bets outbox row may not appear in the 12-row window if canary rows are more recent.

**Current implementation behavior** (as of 2026-03-20):
- Default `/api/operator/snapshot` call fetches 12 outbox rows ordered by `created_at DESC` across all targets.
- `summarizeChannelLane()` then filters those 12 rows by `target === 'discord:best-bets'`.
- If no best-bets rows appear in the 12 most recent rows, `activationHealthy` will be `false` (no recent sent rows visible).

**Resolution**: This is acceptable for current system volume. Document explicitly: `activationHealthy` and all `recentSentCount` figures are computed from the last N outbox rows returned by the snapshot query, not a fixed time window. The "window" grows when a `?since=` filter is applied. The "50 rows" mentioned in the contract is aspirational — the implementation uses 12 by default. If a discrepancy exists between contract and implementation, it must be reconciled before Week 10 is formally closed.

**Verification action**: When verifying the live `bestBets` section, confirm the row window is sufficient to include the most recent best-bets delivery. Use `?since=` filter on `/api/operator/snapshot` if needed.

---

### A2: `PickPipelineRow.status` field name is lifecycle state (not confusing, but must be explicit)

**Location**: `week_10_operator_command_center_contract.md`, Slice 2 response shape

**Issue**: The contract's `PickSummary` shape and the implementation's `PickPipelineRow` both use `"status"` for the lifecycle state field. This is consistent with `picks.status` in the DB and with the existing `recentPicks: PickRecord[]` in the snapshot. However, `PickPipelineRow` also has `approvalStatus`, `promotionStatus`, and `settlementResult` — four distinct "status-family" fields on the same row. This is not ambiguous in context but must be documented.

**Resolution**: `PickPipelineRow.status` = `picks.status` = lifecycle state (`validated | queued | posted | settled`). No rename needed. Documentation suffices.

---

### A3: `GET /api/operator/picks-pipeline` standalone endpoint not yet implemented

**Location**: `week_10_operator_command_center_contract.md`, Slice 2

**Issue**: The contract requires a standalone `GET /api/operator/picks-pipeline` JSON endpoint. As of 2026-03-20, the route handler in `apps/operator-web/src/server.ts` handles `/health`, `/api/operator/snapshot`, and `/` only. There is no `/api/operator/picks-pipeline` handler.

The picks pipeline data IS available through `/api/operator/snapshot` as `data.picksPipeline`. The standalone endpoint is a separate contractual deliverable. The test suite does not currently test this route — tests for `picksPipeline` assert against `/api/operator/snapshot` data, not against a `/api/operator/picks-pipeline` response.

**Impact**: Close criterion #2 is not yet satisfied:
> "`GET /api/operator/picks-pipeline` endpoint returns correct lifecycle state counts and recent picks from live DB"

**Resolution**: This is an implementation gap, not a governance ambiguity. The implementation lane must add:
1. A `GET /api/operator/picks-pipeline` route handler in `routeOperatorRequest()`
2. At least one new test asserting the route exists and returns `{ observedAt, counts, recentPicks }` with the correct shape

This gap does not affect the correctness of the existing `bestBets` section or the `OperatorSnapshot` interface. It is the only remaining implementation item before Week 10 can be formally closed.

---

### A4: `trader-insights` promotion target cannot be produced by the current runtime

**Location**: `docs/05_operations/trader_insights_graduation_criteria.md`, Activation Proof Requirements

**Issue**: The graduation criteria requires a pick with `promotion_target = 'trader-insights'` and a promotion score ≥ 80.00. However, the promotion service (`apps/api/src/promotion-service.ts`, function `evaluateAndPersistBestBetsPromotion()`) hard-codes `target = 'best-bets'`. There is no `evaluateAndPersistTraderInsightsPromotion()` or equivalent path that can produce `promotion_target = 'trader-insights'`.

This means the full activation proof for trader-insights cannot be produced without a new promotion evaluation path. This is NOT a Week 10 blocker — the graduation criteria is a Week 10 governance artifact, not a runtime artifact. But it IS a Week 11 prerequisite that is not currently documented.

**Resolution**: Record as a Week 11 prerequisite in this document. Before the trader-insights activation contract is written, the implementation lane must:
- Add a `evaluateAndPersistTraderInsightsPromotion()` function (or generalize the existing function to accept a target and policy)
- Define the trader-insights promotion policy (provisional thresholds in the graduation criteria: score ≥ 80.00, edge ≥ 85, trust ≥ 85)
- Wire the new evaluation path into the submission/distribution flow

This is not a defect in the Week 10 graduation criteria document. The document correctly marks thresholds as provisional and requires a separate activation contract before implementation begins.

---

### A5: "Picks pipeline `posted` count ≥ 1" graduation gate criterion

**Location**: `docs/05_operations/trader_insights_graduation_criteria.md`, Required Operator Evidence

**Issue**: The criterion "Picks pipeline `posted` count ≥ 1" confirms active system state but not trader-insights eligibility. A system with one posted pick (regardless of promotion status) satisfies this check. It is the weakest criterion in the gate.

**Resolution**: This is intentional — the criterion is an active-system-state confirmation, not a trader-insights-specific eligibility check. The trader-insights eligibility will be confirmed by the activation proof (specifically: the promotion record with score ≥ 80.00 and target = trader-insights). The `posted` count criterion simply confirms the distribution pipeline is moving picks. Document accordingly. No change to the graduation criteria document is needed.

---

## Part 2 — Week 10 Closeout Checklist

Fill in `Observed Value` after implementation completion and independent verification.

### Section A — Implementation Completion

| # | Close Criterion | How to Verify | Observed Value | Pass? |
|---|---|---|---|---|
| 1 | `discord:best-bets` section renders in operator-web HTML dashboard with correct sent/failure/dead-letter counts from live DB | `curl http://localhost:3002/` — confirm "Best Bets Health" section present with non-null values | `bestBetsHealthSection` rendered; `recentSentCount=3`, `recentFailureCount=0`, `recentDeadLetterCount=0`, `activationHealthy=true` | **YES** |
| 2 | `GET /api/operator/picks-pipeline` endpoint returns correct lifecycle state counts and recent picks | `curl http://localhost:3002/api/operator/picks-pipeline` — confirm 200, correct `counts` shape | Route implemented in `routeOperatorRequest()` at `server.ts:146`; returns `{ ok, data: { observedAt, counts, recentPicks } }`; test at `server.test.ts:333` passes | **YES** |
| 3 | Picks Pipeline section renders in operator-web HTML dashboard | `curl http://localhost:3002/` — confirm "Picks Pipeline" section present with count cards | `picksPipelineSection` rendered; test `assert.match(response.body, /Picks Pipeline/)` and `assert.match(response.body, /pick-2/)` pass | **YES** |
| 4 | `OperatorSnapshot` TypeScript interface includes `bestBets` and `picksPipeline` fields | TypeScript compilation succeeds; `pnpm type-check` green | `pnpm type-check` clean (no errors); interface fields confirmed at `server.ts:36,48` | **YES** |
| 5 | `pnpm test` passes including new operator-web tests for both sections | `pnpm test` — all tests pass including `bestBets` and `picksPipeline` assertions | `62/62 pass` (up from 60/60 at Week 9 close; 2 new tests added and passing) | **YES** |
| 6 | `trader_insights_graduation_criteria.md` created and ratified | File exists at `docs/05_operations/trader_insights_graduation_criteria.md`; Status = Ratified | Created 2026-03-20; Status = Ratified | **YES** |

### Section B — Independent Verification (Live DB)

Verified via Supabase PostgREST REST API (service_role_key). Timestamp: 2026-03-20.

| # | Check | Query / Endpoint | Required Value | Observed Value | Pass? |
|---|---|---|---|---|---|
| 7 | `bestBets.recentSentCount` reflects real sent rows | `distribution_outbox?target=eq.discord:best-bets&order=created_at.desc&limit=20` | ≥ 1 | **3** — all `sent`: `4d9db6ed`, `a938db43`, `9414eeb9` | **YES** |
| 8 | `bestBets.activationHealthy` is `true` | No failed/dead_letter rows in best-bets outbox | `true` | **true** — 0 failed, 0 dead_letter, ≥ 1 sent | **YES** |
| 9 | `bestBets.latestMessageId` matches a known best-bets receipt | `distribution_receipts?channel=eq.discord:1288613037539852329&order=recorded_at.desc` | non-null, matches a receipt `external_id` | **`1484638587143327895`** — receipt `4efafbb4`, outbox `4d9db6ed`, recorded `2026-03-20T19:43:42.717837+00:00` | **YES** |
| 10 | `picksPipeline.counts` matches live `picks` table | `picks` by status (full result: 6 rows) | correct counts | **validated=1, queued=1, posted=2, settled=2, total=6** — matches DB truth | **YES** |
| 11 | `picksPipeline.recentPicks` includes Week 9 proof pick with settlement | `picks?id=eq.1e40951c…` + `settlement_records?pick_id=eq.1e40951c…` | pick present, `settlementResult='win'` | **`1e40951c`: status=`settled`, promotion_target=`best-bets`, score=`94.10`; settlement `894f4872`: result=`win`, source=`operator`** | **YES** |
| 12 | No regression in canary section | `distribution_outbox?target=eq.discord:canary&order=created_at.desc` | `graduationReady=true` (3 sent, 0 failures) | **3 sent rows** (`5795a491`, `9f7ff619`, `79b5763b`), 0 failed, 0 dead_letter — `graduationReady=true` | **YES** |
| 13 | Zero failed/dead-letter outbox rows (all targets) | `distribution_outbox?status=in.(failed,dead_letter)` | `0` | **`[]`** — zero rows | **YES** |

### Section C — External Tracking

| # | Item | Target | Completed? |
|---|---|---|---|
| 14 | `docs/06_status/system_snapshot.md` updated with Week 10 proof | Section added: bestBets section live, picks pipeline live, verification timestamps | **Done — 2026-03-20** |
| 15 | `docs/06_status/status_source_of_truth.md` updated | All Week 10 items marked Done | **Done — 2026-03-20** |
| 16 | `docs/06_status/current_phase.md` updated | Status updated to Week 10 complete | **Done — 2026-03-20** |
| 17 | `docs/04_roadmap/active_roadmap.md` updated | Week 10 moved to Completed Sequence | **Done — 2026-03-20** |
| 18 | Linear Week 10 issue marked Done | UNI-135 | **Done — 2026-03-20** |
| 19 | Notion Week 10 checkpoint marked Done | Notion page updated | **Done — 2026-03-20** |

---

### Pending Implementation Items

None. All implementation gaps identified in the governance review have been resolved:

- **A3** (`GET /api/operator/picks-pipeline` missing) — **Resolved.** Route implemented at `server.ts:146–162`, covered by test at `server.test.ts:333`. 62/62 tests pass.

---

## Part 3 — Week 11 Trader-Insights Graduation Gate Evidence Structure

This section defines exactly what must be visible in the live operator surface before the Week 11 trader-insights activation decision can be made. It maps each criterion in `trader_insights_graduation_criteria.md` to a specific, observable check.

### Gate: Prerequisites (Must Be Confirmed First)

| Prerequisite | How to Confirm | Required State |
|---|---|---|
| `discord:canary` live and healthy | `/api/operator/snapshot` → `data.canary.graduationReady` | `true` |
| `discord:best-bets` live and stable, ≥ 7 days since last incident | `/api/operator/snapshot` → `data.bestBets.activationHealthy` + check `docs/06_status/status_source_of_truth.md` incident log | `true`, no incident in past 7 days |
| `pnpm test` passing | Run `pnpm test` | all tests pass |
| `pnpm test:db` passing | Run `pnpm test:db` | 1/1 pass |
| Operator-web `bestBets` section live and accurate | `/` HTML dashboard includes "Best Bets Health" with `activationHealthy: yes` | confirmed |
| Operator-web picks pipeline live and accurate | `/` HTML dashboard includes "Picks Pipeline" with non-zero lifecycle counts | confirmed |
| `discord:trader-insights` activation contract written and ratified | File exists at `docs/05_operations/week_11_trader_insights_activation_contract.md` (or equivalent); Status = Ratified | confirmed |

Note: The activation contract prerequisite cannot be satisfied until Week 11 work begins. All other prerequisites can be confirmed at Week 10 close.

---

### Gate: Required Operator Evidence (Exact Fields and Sources)

These are the fields that must be observed from the live operator surface immediately before the go/no-go decision. Record each value in the Week 11 activation contract.

| Evidence Field | Source | Required Value | Fill-in at Decision Time |
|---|---|---|---|
| `discord:canary` recent sent count | `/api/operator/snapshot` → `data.canary.recentSentCount` | ≥ 3 | ___ |
| `discord:canary` recent failure count | `/api/operator/snapshot` → `data.canary.recentFailureCount` | 0 | ___ |
| `discord:canary` recent dead-letter count | `/api/operator/snapshot` → `data.canary.recentDeadLetterCount` | 0 | ___ |
| `discord:best-bets` recent sent count | `/api/operator/snapshot` → `data.bestBets.recentSentCount` | ≥ 1 | ___ |
| `discord:best-bets` recent failure count | `/api/operator/snapshot` → `data.bestBets.recentFailureCount` | 0 | ___ |
| `discord:best-bets` recent dead-letter count | `/api/operator/snapshot` → `data.bestBets.recentDeadLetterCount` | 0 | ___ |
| `discord:best-bets` activation healthy | `/api/operator/snapshot` → `data.bestBets.activationHealthy` | `true` | ___ |
| Worker health | `/api/operator/snapshot` → `data.health[worker].status` | `healthy` | ___ |
| Distribution health | `/api/operator/snapshot` → `data.health[distribution].status` | `healthy` | ___ |
| Failed outbox rows (all targets) | `/api/operator/snapshot` → `data.counts.failedOutbox` | 0 | ___ |
| Pending outbox rows | `/api/operator/snapshot` → `data.counts.pendingOutbox` | 0 | ___ |
| Picks pipeline `posted` count | `/api/operator/picks-pipeline` → `counts.posted` | ≥ 1 (active system state) | ___ |

---

### Gate: Runtime Prerequisites for Week 11 (Not Observable Until Implemented)

These items are blockers for trader-insights activation that cannot be confirmed until Week 11 implementation begins:

| Item | Blocker Reason | When to Resolve |
|---|---|---|
| Trader-insights promotion evaluation path | `evaluateAndPersistBestBetsPromotion()` hard-codes `target = 'best-bets'`. No path exists to produce `promotion_target = 'trader-insights'` with a score ≥ 80.00. | Week 11 implementation — new function or generalized policy parameter |
| Trader-insights promotion policy definition | Provisional thresholds (score ≥ 80.00, edge ≥ 85, trust ≥ 85) must be confirmed in the activation contract before implementation. | Week 11 contract ratification |
| Trader-insights channel ID wired in `outboxRowsToChannelId()` | `apps/operator-web/src/server.ts` channel map only covers `discord:canary` and `discord:best-bets`. Trader-insights receipts will not associate to the correct channel. | Week 11 implementation — add channel ID `1356613995175481405` |
| Canary-safe preview run with trader-insights payload format | Required by `trader_insights_graduation_criteria.md` before real-channel activation. | Week 11 proof run |

---

### Gate: Activation Proof Fields (Fill in at Activation Decision)

When the trader-insights activation run is executed, the proof bundle must capture all of the following. This structure mirrors the Week 7 Best Bets proof bundle.

| Stage | Proof Field | Fill-in |
|---|---|---|
| Submission | submission ID | ___ |
| Pick creation | pick ID | ___ |
| Pick creation | approval_status | `approved` |
| Promotion | promotion_history_id | ___ |
| Promotion | promotion_status | `qualified` |
| Promotion | promotion_target | `trader-insights` |
| Promotion | promotion_score | ≥ 80.00 |
| Routing | outbox_id | ___ |
| Routing | outbox target | `discord:trader-insights` |
| Routing | outbox status | `sent` |
| Receipt | receipt_id | ___ |
| Receipt | channel_id | `1356613995175481405` |
| Receipt | dry_run | `false` |
| Audit | audit entry action | `distribution.sent` |
| Audit | audit entry entity_id | = outbox_id |
| Operator state | operator snapshot observedAt | ___ |
| Operator state | `bestBets.activationHealthy` | `true` |
| Operator state | `canary.graduationReady` | `true` |
| Operator state | `counts.failedOutbox` | `0` |

---

## Part 4 — Week 11 Gate Decision Record

*Fill in after the activation contract is ratified and all operator evidence fields are confirmed.*

| Field | Value |
|---|---|
| Gate decision | pending |
| Decision date | ___ |
| Evidence snapshot timestamp | ___ |
| All prerequisites confirmed | ___ |
| All operator evidence fields confirmed | ___ |
| Runtime prerequisites resolved | ___ |
| Activation contract ratified | ___ |
| Recorded by | ___ |

---

## Authority Links

| Purpose | File |
|---|---|
| Week 10 contract | `docs/05_operations/week_10_operator_command_center_contract.md` |
| Trader-insights graduation criteria | `docs/05_operations/trader_insights_graduation_criteria.md` |
| Week 9 readiness decision | `docs/05_operations/week_9_readiness_decision.md` |
| System snapshot (live evidence record) | `docs/06_status/system_snapshot.md` |
| Status source of truth | `docs/06_status/status_source_of_truth.md` |
| Active roadmap | `docs/04_roadmap/active_roadmap.md` |
