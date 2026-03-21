# Notion Update Pack

Use this pack to update Notion so it matches the current repo authority.

Reference docs:
- `docs/04_roadmap/active_roadmap.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
- `docs/06_status/next_build_order.md`
- `docs/05_operations/canary_graduation_criteria.md`

## Pages To Update

### Rebuild Home

Update summary to:
- Week 1 complete
- Week 2 complete
- Week 3 complete
- Week 4 in progress

Add short status note:
- live Discord canary delivery is proven
- operator-web is active as a read-only operational surface
- smart-form is active as an intake surface with browser-facing confirmation and validation feedback
- live routing remains constrained to `discord:canary`

### Weekly Status

Create or update the current weekly/checkpoint entry with:

Title:
- `Week 4 Checkpoint - Intake Surface Refined`

Sections:
- Current stage
  - Week 4 intake and operational refinement in progress
- Proven this week
  - fresh live canary post through embed path
  - operator snapshot visibility against live DB
  - smart-form HTML intake surface and API handoff
  - smart-form browser feedback and confirmation UX
- Risks
  - operator filtering still lightweight
  - no written graduation criteria for `discord:best-bets` yet
  - milestone tracking debt still exists for M3/M4
- Next build order
  - operator incident view
  - canary graduation criteria
  - milestone tracking cleanup

### Decision Log

Add or update entries for:
- chat history is not the system of record; repo docs are
- live routing remains `discord:canary` only until explicit graduation criteria are written and passed
- promotion to `discord:best-bets` is governed by the canary graduation criteria doc
- operator-web is read-only and should not mutate canonical business state
- smart-form is intake-only and does not directly write canonical tables

### Risk Register

Ensure these active risks exist:
- Notion/Linear discipline lagging behind repo state
- operator visibility still shallow for incident investigation
- expansion beyond canary lacks written graduation criteria
- milestone tracking debt obscures completed roadmap slices

### Migration Ledger

Add note:
- legacy repo remains reference-only
- no authority is derived from chat memory
- Discord target IDs were extracted and verified against legacy code but V2 routing policy is governed by repo docs

## Suggested Notion Status Wording

Use this exact short summary if helpful:

`unit-talk-v2` has completed the Week 3 checkpoint and remains in Week 4. The live canary flow is proven end to end: submission -> lifecycle -> outbox -> worker -> Discord -> receipt -> audit. Operator visibility is available through a read-only operator surface. Smart Form now includes browser-facing validation and confirmation UX. The remaining Week 4 work is operator incident visibility, graduation criteria, and milestone tracking cleanup.

## Rule After Update

Once Notion is updated, it should agree with:
- `docs/04_roadmap/active_roadmap.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
