# Week 14 Failure / Rollback Template

## Metadata

| Field | Value |
|---|---|
| Week | 14 — Verification Control Plane Salvage |
| Template status | Pre-implementation (fill in only if a failure condition is triggered) |
| Authority | `docs/05_operations/week_14_verification_control_plane_salvage_contract.md` |

---

## Failure Trigger Conditions

Halt Week 14 and record here if any of the following occur:

- Any of the 87 pre-Week-14 tests regress
- `pnpm test:db` fails
- `packages/verification` cannot build independently
- Type-check or lint failures introduced in existing packages
- Any import from `unit-talk-production` appears in V2 runtime code
- Operator snapshot stops returning `canary`, `bestBets`, or `traderInsights` data
- `GET /` dashboard renders incorrectly for any prior section

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

- [ ] Removed `packages/verification` directory
- [ ] Removed root tsconfig reference to `packages/verification`
- [ ] Removed CLI scripts from `apps/api/package.json`
- [ ] Removed query-runs.ts script
- [ ] Reverted root `package.json` test command
- [ ] Reverted `.gitignore` changes
- [ ] Confirmed `pnpm test` returns to 87/87
- [ ] Confirmed `pnpm test:db` passes 1/1
- [ ] Confirmed `pnpm verify` clean
- [ ] Confirmed operator snapshot unchanged

### Post-revert state

| Check | Result |
|---|---|
| `pnpm test` | /87 |
| `pnpm test:db` | /1 |
| `pnpm type-check` | |
| `pnpm build` | |
| `pnpm lint` | |
| Operator snapshot `canary` section | |
| Operator snapshot `bestBets` section | |
| Operator snapshot `traderInsights` section | |

### Root cause

_Describe the root cause of the failure._

### Resolution path

_Describe what must be addressed before retrying Week 14 implementation._

---

## Status Update Required

After recording a failure here:
1. Update `docs/06_status/status_source_of_truth.md` — Week 14 failure, Week 14 remains open
2. Update `docs/06_status/current_phase.md` — reflect open status and blocker
3. Do not begin Week 15 work
