# Week 10 — Operator Command Center Normalization

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

---

## Objective

Upgrade the operator-web into a multi-channel command center that shows accurate health, outbox state, and pick pipeline state for all live targets (`discord:canary` and `discord:best-bets`), and define the graduation criteria document that must be satisfied before `discord:trader-insights` is activated.

No new runtime routing. No new Discord channels. No schema migrations.

---

## Slice Selection Rationale

Three candidates were evaluated from the post-Week-9 readiness decision.

### Chosen: Cross-app normalization — Operator Command Center

The readiness decision requires:
> "operator visibility confirmed sufficient before activation"

That condition is not yet satisfied:
- The operator dashboard has a `canary` readiness section but no equivalent for `discord:best-bets`.
- There is no picks pipeline view showing lifecycle state, promotion state, or settlement state per pick.
- There is no `trader_insights_graduation_criteria.md` defining what "sufficient" means.

Without these, activating `discord:trader-insights` in Week 11 would have no defined gate and no operator surface capable of confirming the gate is met.

This slice directly satisfies the prerequisite for Week 11 channel activation. It carries zero live routing risk.

### Not chosen: Next simplest channel activation (`discord:trader-insights`)

Blocked for three reasons:

1. The readiness decision explicitly requires "operator visibility confirmed sufficient before activation" — a condition that is not yet met and cannot be verified with the current operator surface.
2. No promotion eligibility criteria for `discord:trader-insights` have been defined. The current promotion gate qualifies picks for `discord:best-bets`; a separate eligibility profile or threshold is required for a VIP+ market-alerts channel.
3. A full controlled activation sequence (eligibility definition → canary proof run → real-channel activation → monitoring window) is 2–3 weeks of work. It is not a one-week slice.

Correct for Week 11 after this contract closes.

### Not chosen: Dev-ops/control hardening (Docker, structured logging)

The system has operated cleanly for 9 weeks without Docker or structured logging. No current incident or deployment failure requires containerization this week. This is valid and important but does not unblock the primary business goal. Correct for Week 12 or alongside channel expansion work.

---

## Entry Criteria (All Met)

| Condition | Status |
|---|---|
| Week 9 formally closed | Done — 2026-03-20 |
| `discord:best-bets` live and stable | Done |
| `discord:canary` active and permanent | Done |
| `pnpm test` passing (60/60) | Done |
| `pnpm test:db` passing (1/1) | Done |
| Week 10 contract written and in repo | Done — this document |

---

## In-Scope

### Slice 1 — `discord:best-bets` Channel Health Section in Operator-Web

Add a `bestBets` channel health section to the operator-web that mirrors the existing `canary` section:

- recent sent count (configurable window, default last 50 rows)
- recent failure count
- recent dead-letter count
- latest sent-at timestamp
- latest receipt recorded-at timestamp
- latest Discord message ID
- `activationHealthy: boolean` — true if zero failed/dead_letter rows and at least one recent sent row

Update `OperatorSnapshot` TypeScript interface to include a `bestBets` field parallel to `canary`. Both fields must use the same shape.

Render the `bestBets` section in the operator-web HTML dashboard below or alongside the existing canary readiness section.

Deliverable: operator-web HTML dashboard renders a `discord:best-bets` channel health card. Tests cover the section.

### Slice 2 — Picks Pipeline Section in Operator-Web

Add a picks pipeline view to the operator-web:

**New JSON endpoint: `GET /api/operator/picks-pipeline`**

Returns:
```json
{
  "observedAt": "ISO timestamp",
  "counts": {
    "validated": 0,
    "queued": 0,
    "posted": 0,
    "settled": 0,
    "total": 0
  },
  "recentPicks": [
    {
      "id": "uuid",
      "status": "settled",
      "approvalStatus": "approved",
      "promotionStatus": "qualified",
      "promotionTarget": "best-bets",
      "promotionScore": 94.1,
      "settlementResult": "win",
      "createdAt": "ISO timestamp",
      "settledAt": "ISO timestamp or null"
    }
  ]
}
```

Optional query parameter: `?lifecycleState=posted` to filter recent picks by status.

**HTML dashboard section: Picks Pipeline**

Add a Picks Pipeline section to the operator-web HTML dashboard showing:
- Lifecycle state count cards (validated / queued / posted / settled)
- Recent picks table with: ID, status, approval, promotion status, score, target, settlement result

Update `OperatorSnapshot` interface to include `picksPipeline: { counts: {...}, recentPicks: PickSummary[] }`.

Deliverable: picks pipeline endpoint returns correct live data; HTML renders picks pipeline section. Tests cover the endpoint and snapshot interface.

### Slice 3 — Trader-Insights Graduation Criteria Document

Create `docs/05_operations/trader_insights_graduation_criteria.md` defining:

- The operator state that must be confirmed true before `discord:trader-insights` is added to `UNIT_TALK_DISTRIBUTION_TARGETS`
- Required operator evidence fields (parallel to the canary graduation criteria structure)
- What "recent sent count" threshold is required for trader-insights
- Rollback trigger conditions specific to trader-insights
- The promotion eligibility decision for trader-insights: same threshold as best-bets, or a distinct profile?

This document is a governance artifact only. No runtime code is written for it in Week 10. The document is a prerequisite for the Week 11 trader-insights activation contract.

Deliverable: `trader_insights_graduation_criteria.md` exists, is ratified, and is linked from `status_source_of_truth.md`.

---

## App and Order Impact

| App | Week 10 Impact | Notes |
|---|---|---|
| `apps/operator-web` | **Primary** — Slices 1, 2, and 3 doc reference | All three deliverables live here |
| `apps/api` | **None** | Operator-web queries Supabase directly; no new API routes needed |
| `apps/worker` | **None** | No runtime changes |
| `apps/smart-form` | **None** | No changes |
| `apps/discord-bot` | **None** | Remains a stub |
| Docker / runtime layer | **None** | No containerization changes |
| `packages/db` | **Minimal** | May require a picks-pipeline query helper if not already present; no schema changes |

---

## Non-Goals

The following are explicitly out of scope for Week 10:

- No new Discord channel routing — `discord:trader-insights`, `discord:exclusive-insights` remain inactive for live routing
- No changes to `discord:canary` or `discord:best-bets` target map
- No schema migrations
- No new API routes in `apps/api`
- No smart-form changes of any kind
- No worker changes of any kind
- No Docker or deployment layer changes
- No automated settlement feed
- No promotion gate changes (promotion threshold or eligibility logic unchanged)
- No new product surfaces
- No Week 11 or Week 12 implementation work

---

## Execution Checklist

### Pre-Implementation

- [ ] `pnpm type-check` green
- [ ] `pnpm build` green
- [ ] `pnpm test` green (60/60)
- [ ] `pnpm test:db` green (1/1)
- [ ] operator snapshot: worker health healthy, zero failed outbox rows
- [ ] `discord:canary` and `discord:best-bets` both healthy in live DB

### Slice 1 — bestBets Channel Health

- [ ] `OperatorSnapshot` interface updated to include `bestBets` field
- [ ] `bestBets` data populated from live DB (same pattern as `canary`)
- [ ] `bestBets` section renders in HTML dashboard
- [ ] `server.test.ts` updated — `bestBets` section tested

### Slice 2 — Picks Pipeline

- [ ] `GET /api/operator/picks-pipeline` endpoint implemented
- [ ] Lifecycle state counts computed from live picks table
- [ ] Recent picks filtered and mapped to `PickSummary` shape
- [ ] `?lifecycleState=` query parameter filtering works
- [ ] `OperatorSnapshot` interface updated to include `picksPipeline`
- [ ] Picks Pipeline section renders in HTML dashboard
- [ ] `server.test.ts` updated — picks pipeline endpoint tested

### Slice 3 — Trader-Insights Graduation Criteria Doc

- [ ] `docs/05_operations/trader_insights_graduation_criteria.md` created
- [ ] Operator state thresholds defined
- [ ] Rollback trigger conditions defined
- [ ] Promotion eligibility decision recorded
- [ ] Authority link added to `status_source_of_truth.md`

### Post-Implementation Verification

- [ ] Verify `bestBets` section shows correct data from live DB
- [ ] Verify picks pipeline shows correct lifecycle state counts from live DB
- [ ] Verify `pnpm test` passes (all tests including new ones)
- [ ] Verify no regression in canary section behavior
- [ ] Operator snapshot confirms zero failed/dead_letter rows

### Close and External Tracking

- [ ] `docs/06_status/system_snapshot.md` updated with Week 10 proof
- [ ] `docs/06_status/status_source_of_truth.md` updated
- [ ] `docs/06_status/current_phase.md` updated
- [ ] `docs/04_roadmap/active_roadmap.md` updated
- [ ] Linear Week 10 issue marked Done
- [ ] Notion Week 10 checkpoint marked Done

---

## Close Criteria

Week 10 is complete only when all of the following are true:

1. `discord:best-bets` section renders in operator-web HTML dashboard with correct sent/failure/dead-letter counts sourced from the live DB
2. `GET /api/operator/picks-pipeline` endpoint returns correct lifecycle state counts and recent picks from live DB
3. Picks Pipeline section renders in the operator-web HTML dashboard
4. `OperatorSnapshot` TypeScript interface includes `bestBets` and `picksPipeline` fields, and all existing tests pass
5. `pnpm test` passes including new operator-web tests for both sections
6. `trader_insights_graduation_criteria.md` created and ratified
7. Independent verification: live DB confirms `bestBets` data and picks pipeline data are accurate
8. `docs/06_status/system_snapshot.md` updated with Week 10 verification
9. Linear Week 10 issue Done
10. Notion Week 10 checkpoint Done

---

## Failure Conditions

- Operator-web HTML returns 500 or blank page after changes
- Existing canary section behavior changes or test regresses
- `OperatorSnapshot` interface change breaks TypeScript compilation
- `pnpm test` regression of any kind

There are no live routing changes in this slice, so no program kill conditions are in scope.

---

## What May Start After Week 10

Determined by whether close criteria are met and by `trader_insights_graduation_criteria.md` content.

| Candidate | Decision | Condition |
|---|---|---|
| `discord:trader-insights` live routing | **may proceed** | Requires `trader_insights_graduation_criteria.md` satisfied AND operator-web shows trader-insights graduation ready AND a separate activation contract |
| `discord:exclusive-insights` live routing | **may proceed** | Same conditions as trader-insights |
| Dev-ops/control hardening (Docker, structured logging) | **may proceed** | No technical blocker; schedule as Week 12 or alongside channel expansion |
| Automated settlement feed | **may proceed** | Requires separate contract with idempotency design |

## What Remains Blocked Regardless

- `discord:game-threads` — thread routing architectural gap; not in scope until resolved
- `discord:strategy-room` — DM routing architectural gap; not in scope until resolved
- Any new product surface without a written and ratified contract

---

## Authority Links

| Purpose | File |
|---|---|
| Post-Week-9 readiness decision | `docs/05_operations/week_9_readiness_decision.md` |
| Trader-insights graduation criteria | `docs/05_operations/trader_insights_graduation_criteria.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
| Evidence record | `docs/06_status/system_snapshot.md` |
| Active roadmap | `docs/04_roadmap/active_roadmap.md` |
