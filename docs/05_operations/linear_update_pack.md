# Linear Update Pack

Use this pack to bring Linear into sync with the current repo reality.

Reference docs:
- `docs/04_roadmap/active_roadmap.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
- `docs/06_status/next_build_order.md`
- `docs/05_operations/canary_graduation_criteria.md`

## Milestone State

Update milestone status as follows:

- `UTV2-M1 Ratified Contracts`
  - mark complete
- `UTV2-M2 Canonical Schema Live`
  - mark complete
- `UTV2-M3 Submission Path Live`
  - mark complete
- `UTV2-M4 Lifecycle Enforced`
  - mark complete
- `UTV2-M5 Discord Post End-to-End`
  - mark complete
- `UTV2-M7 Operator Control v1`
  - mark in progress

Notes:
- Week 3 checkpoint is complete
- Week 4 is the active execution slice

## Issues To Mark Done

These issue themes are effectively complete in code and should be closed or moved to `Done` if they exist:
- repo bootstrap / tooling foundation
- CI / lint / type-check / build guardrails
- canonical schema and Supabase live setup
- submission path
- lifecycle skeleton
- outbox / receipt / audit flow
- Discord worker path
- first live canary proof
- operator read model v1 foundation
- smart-form validation and confirmation UX

## Issues To Move To In Progress

These should be the current active Week 4 lane:

### Smart Form

Suggested issue title:
- `UTV2-SF-01 Build smart-form intake surface`

Current status:
- `Done`

Acceptance notes:
- smart-form exists as a real HTML surface
- posts through the backend-owned submission path
- includes user-facing success/error feedback

Suggested child/follow-up issue:
- `UTV2-SF-02 Add validation feedback and confirmation UX to smart-form`

Status note:
- if `UTV2-SF-02` exists, move it to `Done`
- `UTV2-SF-01` can now be moved to `Done` if Linear still showed it as in progress

### Operator Web

Suggested issue title:
- `UTV2-OPS-03 Expand operator-web incident visibility`

Current status:
- `In Progress`

Acceptance notes:
- read-only operator surface exists
- health/counts/recent rows are visible
- filtering exists but is still lightweight
- incident-focused visibility still needs refinement

Suggested child/follow-up issue:
- `UTV2-OPS-04 Add richer operator filtering and incident-oriented views`

### Discord Routing Governance

Suggested issue title:
- `UTV2-DIST-04 Define canary graduation criteria for next live target`

Current status:
- `Ready`

Acceptance notes:
- must define written criteria before `discord:best-bets` can go live
- no routing expansion before the criteria issue is complete

Status note:
- the repo authority doc now exists at `docs/05_operations/canary_graduation_criteria.md`
- update the issue description or comment so Linear cites the criteria file directly

### Tracking Debt Cleanup

Suggested issue titles:
- `UTV2-PIPE-02 Retroactively link submission path milestone evidence`
- `UTV2-LIFE-02 Retroactively link lifecycle enforcement milestone evidence`

Current status:
- `Todo`

Acceptance notes:
- close the gap causing `UTV2-M3 Submission Path Live` and `UTV2-M4 Lifecycle Enforced` to appear incomplete
- this is bookkeeping and proof alignment, not missing implementation work

## Issues To Keep Blocked Or Deferred

Do not move these into active implementation yet:
- `discord:best-bets` live promotion
- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- broad multi-channel Discord rollout
- settlement-heavy expansion outside the active roadmap sequence

## Suggested Linear Comment / Update Text

Use this exact short update if helpful:

`unit-talk-v2` has completed the Week 3 checkpoint and remains in Week 4. Live canary delivery is proven with embed-based Discord posts, receipts, audit records, and operator visibility. Smart Form now includes browser-facing validation and confirmation UX. The remaining Week 4 work is operator incident visibility, canary graduation criteria, and milestone tracking cleanup. Live routing remains canary-only until written graduation criteria exists for the next target.

## Rule After Update

Once Linear is updated, it should agree with:
- `docs/04_roadmap/active_roadmap.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/next_build_order.md`
