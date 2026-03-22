# Linear Finish Pack

Use this pack to finish the `unit-talk-v2` Linear workspace so it behaves like the real execution control plane.

This is the companion to:
- `docs/05_operations/linear_setup.md`

Use this file when:
- the base Linear structure already exists
- issues, projects, labels, and milestones are present and aligned
- the remaining work is saved views, project pulse, initiative shape, and integration checks

If newer repo truth exists than the snapshot in this file, update this file first before using it as an execution handoff.

---

## Goal

Bring Linear from "mostly seeded" to "main source of execution truth" quality.

---

## Current Reality Snapshot (2026-03-21)

### Team

- Team exists: `Unit Talk`
- Key: `UNI`

### Labels

The core setup labels already exist including delivery, risk/priority, work type, and ownership labels.

### Projects — Current State

| Project | Status | Notes |
|---------|--------|-------|
| UTV2-R1 Foundation | Completed | All FOUND issues Done |
| UTV2-R2 Contracts | Completed | All CONTRACT issues Done |
| UTV2-R3 Core Pipeline | Completed | All PIPE/SF/LIFE issues Done |
| UTV2-R4 Distribution | Completed | All DIST issues Done, 3 channels live |
| UTV2-R5 Settlement | Completed | Settlement + downstream truth + loss attribution complete |
| UTV2-R6 Operator Control | Completed | OPS-03/04 Done |
| UTV2-R7 Migration | In Progress | Migration ledger, domain salvage, git baseline, E2E validation |
| UTV2-R8 Hardening | Backlog | HARD-01 still in Backlog |

### Milestones — Current State

| Milestone | Status |
|-----------|--------|
| UTV2-M1 Ratified Contracts | Complete |
| UTV2-M2 Canonical Schema Live | Complete |
| UTV2-M3 Submission Path Live | Complete |
| UTV2-M4 Lifecycle Enforced | Complete |
| UTV2-M5 Discord Post End-to-End | Complete |
| UTV2-M6 Settlement End-to-End | Complete |
| UTV2-M7 Operator Control v1 | Complete |
| UTV2-M8 Cutover Ready | Not Started |

### Issue Coverage

- 21 UTV2-* issues (FOUND, CONTRACT, PIPE, DIST, SF, OPS, SETTLE, LIFE, MIG, HARD)
- 10 Week issues (UNI-137 through UNI-146) covering Weeks 11-20
- 29 legacy SPRINT-* issues from production repo
- All completed issues marked Done

### Current Repo Truth

- All weeks 11 through 20 are CLOSED
- 515/515 tests passing, all gates green
- R1-R6 completed, R7 in progress, R8 backlog

Primary authority:
- `docs/06_status/status_source_of_truth.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/next_build_order.md`

---

## Work Already Done

- Team, projects, milestones, labels exist and are aligned
- All UTV2-R1 through R6 projects marked Completed
- UTV2-R7 marked In Progress
- Week 11-20 issues created (UNI-137 through UNI-146), all marked Done
- UNI-133 (SETTLE-01) moved from R4 to R5 project
- UNI-123 (MIG-01) marked Done
- Control-link documents created in earlier sessions

Do not redo that work from scratch. Build on it.

---

## Remaining Finish Work

### 1. Add Saved Views In The Linear UI

Create these saved team views:

#### View 1 - Active Work
- Team: `UNI`
- Status: `In Progress`
- Order: updated descending
- Purpose: show only the real current workstreams

#### View 2 - Migration Queue
- Team: `UNI`
- Project: `UTV2-R7 Migration`
- Status: not `Done`
- Purpose: show remaining migration work

#### View 3 - Hardening Backlog
- Team: `UNI`
- Project: `UTV2-R8 Hardening`
- Status: `Backlog`
- Purpose: keep cutover-prep work visible without mixing into active lane

#### View 4 - Completed History
- Team: `UNI`
- Status: `Done`
- Order: completed descending
- Purpose: compact closed-work history for audits

#### View 5 - Truth Drift / Decisions Needed
- Team: `UNI`
- Labels: `truth-drift` or `decision-needed` or `blocked`
- Status: not `Done`
- Purpose: surface alignment threats

### 2. Add Project Status Updates

For active projects:

#### `UTV2-R7 Migration`
- Status: `In Progress`
- Health: `onTrack`
- Summary: Migration ledger complete, domain salvage Batches 1-5 accepted, git baseline ratified, E2E validation passed. Next: cutover staging.

#### `UTV2-R8 Hardening`
- Status: `Backlog`
- Health: `onTrack`
- Summary: Hardening work intentionally not active yet. HARD-01 incident/rollback plan is the first item.

### 3. Verify Git Integration Readiness

Check in the Linear UI:
- GitHub integration is enabled for the real repo
- repo connected: `griff843/Unit-Talk-v2`
- branch copy behavior uses the Linear issue ID

---

## Things Not To Do

- do not reopen closed historical work
- do not widen beyond the defined next scope
- do not let saved views or initiatives contradict repo authority docs
- do not treat chat history as authority

---

## Completion Check

Linear finish work is complete only when:
- saved views exist
- active project pulse exists
- active issue queue matches repo truth
- project descriptions and resources are current
- Git integration is verified in the UI
- repo docs, Linear, and Notion all tell the same story
