# Week 11 — Failure / Rollback Record Template

Authority: `docs/05_operations/week_11_trader_insights_activation.md`

Use this template if any rollback trigger fires during Week 11. Fill all fields with exact observed values.

---

## Metadata

| Field | Value |
|---|---|
| Week | 11 |
| Phase at failure | ___ (11A or 11B) |
| Template status | ___ (in-use / archived — not triggered) |
| Trigger timestamp | ___ |
| Recorded by | ___ |

---

## Part 1 — 11A Rollback (Generalization regression)

Use this section if 11A implementation breaks existing behavior.

### 1a. Trigger identification

Which condition occurred? (check all that apply)

- [ ] `pnpm test` fell below 62 (existing tests regressed)
- [ ] `pnpm test:db` failed
- [ ] `discord:best-bets` routing behavior changed
- [ ] A best-bets qualified pick failed to reach `discord:best-bets` outbox
- [ ] A non-best-bets pick reached `discord:best-bets` outbox
- [ ] Other regression: ___

### 1b. Regression details

| Test / check | Before 11A | After 11A |
|---|---|---|
| `pnpm test` count | 62 | ___ |
| Regression test name(s) | — | ___ |
| DB state change (if any) | — | ___ |

### 1c. 11A rollback actions

| Action | Done? |
|---|---|
| Reverted generalization changes | ___ |
| `pnpm test` back to ≥ 62 | ___ |
| `pnpm test:db` passing | ___ |
| `discord:best-bets` routing confirmed unchanged | ___ |

### 11A rollback verdict

```
[ ] REVERTED — all regressions fixed, 11A may restart after root cause is resolved
[ ] ESCALATED — regression cannot be quickly reverted, requires architectural review
```

Root cause:
```
___
```

---

## Part 2 — 11B Rollback (Activation failure)

Use this section if a rollback trigger fires during Phase 11B.

### 2a. Trigger identification

Which condition fired? (check all that apply)

**Canary preview triggers (before real-channel activation):**
- [ ] Canary preview: worker delivered to wrong channel (not `discord:1296531122234327100`)
- [ ] Canary preview: receipt `dryRun` was `true` (not `false`)
- [ ] Canary preview: embed displayed "Best Bets" label or title
- [ ] Canary preview: embed errored or produced blank/malformed output
- [ ] Canary preview: `UNIT_TALK_DISCORD_TARGET_MAP` misconfigured — trader-insights routed to real channel prematurely
- [ ] Canary preview: promotion evaluation did not produce `qualified` / `trader-insights` pick

**Real-channel activation triggers:**
- [ ] `discord:trader-insights` outbox row entered `dead_letter` — unrecovered within 24 hours
- [ ] Worker health `degraded` or `down` > 4 consecutive hours, no recovery path
- [ ] A non-trader-insights-qualified pick reached `discord:trader-insights`
- [ ] A pick was delivered to the wrong channel or wrong audience tier (e.g., canary instead of `1356613995175481405`)
- [ ] More than 2 consecutive delivery failures after activation
- [ ] Other: ___

### 2b. Exact failure state

| Field | Value |
|---|---|
| Failure at canary preview or real channel | ___ |
| Approximate time | ___ |
| `UNIT_TALK_DISCORD_TARGET_MAP` value at time of failure | ___ |
| `UNIT_TALK_DISTRIBUTION_TARGETS` value at time of failure | ___ |
| Last successful action before failure | ___ |

**DB state at failure:**

| Table | Row ID | Observed state | Expected state |
|---|---|---|---|
| `distribution_outbox` | ___ | ___ | ___ |
| `distribution_receipts` | ___ | ___ | ___ |
| `picks` | ___ | ___ | ___ |
| `pick_promotion_history` | ___ | ___ | ___ |

**Operator state at failure:**

| Check | Observed |
|---|---|
| `traderInsights.recentFailureCount` | ___ |
| `traderInsights.recentDeadLetterCount` | ___ |
| Worker health | ___ |
| Failed outbox rows (all targets) | ___ |
| `discord:canary` state | ___ |
| `discord:best-bets` state | ___ |

### 2c. Rollback actions

| Action | Done? | Timestamp |
|---|---|---|
| Removed `discord:trader-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS` | ___ | ___ |
| Confirmed `UNIT_TALK_DISCORD_TARGET_MAP` retains entries for canary and best-bets | ___ | ___ |
| Confirmed `discord:canary` remains active and healthy | ___ | ___ |
| Confirmed `discord:best-bets` remains active and healthy | ___ | ___ |
| Confirmed no outbox rows were deleted | ___ | ___ |
| Recorded trigger in `docs/06_status/status_source_of_truth.md` | ___ | ___ |
| Updated `docs/06_status/current_phase.md` | ___ | ___ |

### 2d. Post-rollback state

| Check | Observed | Expected |
|---|---|---|
| `discord:trader-insights` in targets | ___ | not present |
| `discord:canary` in targets | ___ | present |
| `discord:best-bets` in targets | ___ | present |
| Failed outbox rows (canary + best-bets) | ___ | 0 |
| `pnpm test` | ___ | pass |

### 2e. Recovery assessment

| Question | Answer |
|---|---|
| Root cause identified? | ___ |
| `discord:canary` and `discord:best-bets` unaffected? | ___ |
| Generalization (11A) still intact? | ___ |
| Recovery possible without new contract? | ___ |
| Earliest re-activation date if recovery possible | ___ |
| New contract required for re-activation? | ___ |

### 11B rollback verdict

```
[ ] ROLLBACK COMPLETE — discord:trader-insights removed, canary and best-bets stable, 11A intact
[ ] PARTIAL ROLLBACK — action taken, system not yet confirmed stable
[ ] ESCALATED — kill condition triggered, see status_source_of_truth.md hard stop section
```

Root cause summary:
```
___
```

Next steps:
```
1. ___
2. ___
3. ___
```

Recorded by: ___
Date: ___
