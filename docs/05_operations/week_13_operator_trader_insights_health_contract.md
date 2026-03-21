# Week 13 — Operator Trader Insights Health

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-21 |
| Last Updated | 2026-03-21 |

---

## Objective

Add `traderInsights: ChannelHealthSummary` to the operator snapshot, symmetric with the existing `bestBets: ChannelHealthSummary` section, and render a dedicated Trader Insights Health card in the operator-web HTML dashboard.

`discord:trader-insights` has been live since Week 11B (real channel `1356613995175481405`, 2 sent rows confirmed). The operator surface currently has no dedicated visibility into its health. This is the only gap.

---

## Relationship to Prior Weeks

**Week 11B** activated `discord:trader-insights` in real channel `1356613995175481405`. Independent verification PASS 2026-03-21.

**Week 12** hardened the settlement subsystem. No routing or operator surface changes.

**Week 13** closes the operator symmetry gap: three live channels, three monitoring sections.

---

## Pre-Implementation Baseline

| Check | Required state |
|---|---|
| `pnpm test` | 83/83 |
| `pnpm test:db` | 1/1 |
| `apps/operator-web/src/server.ts` | `bestBets: ChannelHealthSummary` already implemented via `summarizeChannelLane()` |
| Live trader-insights sent rows | 2 (`61d4b4a3` canary, `970e688d` real-channel) |
| Live trader-insights failed rows | 0 |

---

## Scope

### Slice 1 — Operator Snapshot Interface

**The gap**: `OperatorSnapshot` has `canary: CanaryReadinessSummary` and `bestBets: ChannelHealthSummary` but no `traderInsights` field. A third live channel has no operator health visibility.

**Deliverables**:

- `OperatorSnapshot` interface: add `traderInsights: ChannelHealthSummary`
- `createSnapshotFromRows()`: call `summarizeChannelLane('discord:trader-insights', ...)` to populate `traderInsights` — exact same pattern as `bestBets`
- `GET /api/operator/snapshot` JSON response: include `traderInsights` in the `data` object

No schema changes. No new routes. No changes to `ChannelHealthSummary` or `summarizeChannelLane()`.

### Slice 2 — Operator Dashboard HTML

**The gap**: The HTML dashboard renders a "Best Bets Health" card but no equivalent for trader-insights.

**Deliverables**:

- `renderOperatorDashboard()`: add "Trader Insights Health" section, symmetric with "Best Bets Health"
- Section renders: target, `recentSentCount`, `recentFailureCount`, `recentDeadLetterCount`, `activationHealthy` flag, `latestMessageId`
- Section is rendered for all states (healthy, degraded, no data)

### Slice 3 — Tests

**Deliverables** (≥4 new tests, all in `apps/operator-web/src/server.test.ts`):

1. `GET /api/operator/snapshot` response includes `traderInsights` field with `target === 'discord:trader-insights'` and `activationHealthy`
2. `createSnapshotFromRows` marks trader-insights `activationHealthy: true` when ≥1 recent sent rows and 0 failures/dead_letter
3. `createSnapshotFromRows` marks trader-insights `activationHealthy: false` when failure or dead_letter rows exist for the target
4. `GET /` HTML renders "Trader Insights Health" section and `discord:trader-insights` target

---

## Close Criteria

| Criterion | Evidence |
|---|---|
| `OperatorSnapshot.traderInsights` field exists and is populated | Code read + test |
| `traderInsights` uses `summarizeChannelLane('discord:trader-insights', ...)` | Code read |
| `GET /api/operator/snapshot` JSON includes `traderInsights` | Test 1 |
| `traderInsights.activationHealthy === true` when no failures | Test 2 |
| `traderInsights.activationHealthy === false` when failure/dead_letter rows present | Test 3 |
| `GET /` HTML renders "Trader Insights Health" section | Test 4 |
| No regression in existing 83 tests | `pnpm test` output |
| `pnpm test` ≥ 87 (83 + ≥4 new) | `pnpm test` output |
| `pnpm test:db` 1/1 | `pnpm test:db` output |
| `pnpm verify` clean (lint + type-check + build + test) | `pnpm verify` output |
| Live snapshot confirms `traderInsights` data against real DB | Independent verification |

---

## Non-Goals

The following are explicitly out of scope for Week 13:

- Smart Form field changes or UX changes of any kind
- New API routes
- Write surfaces in operator-web
- Settlement path changes
- Promotion gate changes
- New channel activations (`discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`)
- Routing changes of any kind
- Schema migrations
- `OperatorSnapshot` interface changes beyond adding `traderInsights`
- Changes to `ChannelHealthSummary` or `summarizeChannelLane()`
- Modification of `canary` or `bestBets` sections
- Automated settlement feeds
- New packages

---

## Rollback / Failure Conditions

Halt Week 13 and do not continue if:

- Any pre-Week-13 test regresses (83 existing tests)
- `pnpm test:db` fails
- Operator snapshot stops returning `canary` or `bestBets` data
- `GET /` dashboard renders incorrectly for any prior section

When triggered:
- Revert Week 13 changes
- Confirm `pnpm test` returns to 83/83 and `pnpm test:db` passing
- Record in `docs/06_status/week_13_failure_rollback_template.md`

---

## Affected Surfaces

| File | Change |
|---|---|
| `apps/operator-web/src/server.ts` | Add `traderInsights: ChannelHealthSummary` to `OperatorSnapshot`; populate in `createSnapshotFromRows()`; render section in `renderOperatorDashboard()` |
| `apps/operator-web/src/server.test.ts` | ≥4 new tests |

No other files require changes.

---

## Artifacts

| Purpose | File |
|---|---|
| Proof template | `docs/06_status/week_13_proof_template.md` |
| Failure / rollback template | `docs/06_status/week_13_failure_rollback_template.md` |

---

## Authority Links

| Purpose | File |
|---|---|
| Settlement architectural contract | `docs/02_architecture/contracts/settlement_contract.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
| Week 10 operator command center contract | `docs/05_operations/week_10_operator_command_center_contract.md` |
| Week 11 activation contract | `docs/05_operations/week_11_trader_insights_activation.md` |
| Week 12 settlement hardening contract | `docs/05_operations/week_12_settlement_hardening_contract.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
