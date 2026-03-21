# Week 13 Failure / Rollback Template

## Metadata

| Field | Value |
|---|---|
| Week | 13 — Operator Trader Insights Health |
| Template status | Pre-implementation (fill in only if a failure condition is triggered) |
| Authority | `docs/05_operations/week_13_operator_trader_insights_health_contract.md` |

---

## Failure Trigger Conditions

Halt Week 13 and record here if any of the following occur:

- Any of the 83 pre-Week-13 tests regress
- `pnpm test:db` fails
- Operator snapshot stops returning `canary` or `bestBets` data
- `GET /` dashboard renders incorrectly for any prior section
- `pnpm type-check` or `pnpm build` fails after changes

---

## Rollback Record

### Failure detected

| Field | Value |
|---|---|
| Date | |
| Trigger condition | |
| Detected by | |

### Failure description

_Describe what failed and what was observed._

### Revert action

- [ ] Reverted Week 13 changes
- [ ] Confirmed `pnpm test` returns to 83/83
- [ ] Confirmed `pnpm test:db` passes 1/1
- [ ] Confirmed `GET /api/operator/snapshot` returns `canary` and `bestBets` correctly
- [ ] Confirmed `GET /` dashboard renders correctly for prior sections

### Post-revert state

| Check | Result |
|---|---|
| `pnpm test` | /83 |
| `pnpm test:db` | /1 |
| `canary` section in snapshot | |
| `bestBets` section in snapshot | |
| Operator HTML dashboard | |

### Root cause

_Describe the root cause of the failure._

### Resolution path

_Describe what must be addressed before retrying Week 13 implementation._

---

## Status Update Required

After recording a failure here:
1. Update `docs/06_status/status_source_of_truth.md` — Week 13 failure, Week 13 remains open
2. Update `docs/06_status/current_phase.md` — reflect open status and blocker
3. Do not begin Week 14 work
