# Linear Finish Pack

Use this pack to finish the `unit-talk-v2` Linear workspace so it behaves like the real execution control plane.

This is the companion to:
- `docs/05_operations/linear_setup.md`

Use this file when:
- the base Linear structure already exists
- some issues, projects, labels, and milestones are present
- the remaining work is alignment, saved views, project pulse, initiative shape, and integration checks

If newer repo truth exists than the snapshot in this file, update this file first before using it as an execution handoff.

---

## Goal

Bring Linear from "mostly seeded" to "main source of execution truth" quality.

At the end of this pass, Linear should:
- reflect the current repo truth without obvious drift
- expose the active work clearly through saved views
- show project-level reality through project descriptions and pulse/status updates
- keep future work visible without widening current scope
- be ready to participate in the real Git-linked workflow once the repo has authoritative commit history

---

## Current Reality Snapshot

As of 2026-03-21, the workspace is partly aligned already.

### Team

- Team exists: `unit-talk-v2`
- Key: `UTV2`

### Labels

The core setup labels already exist, including:
- delivery: `contract`, `schema`, `api`, `worker`, `frontend`, `operator-web`, `discord`, `settlement`, `migration`, `observability`, `docs`, `testing`, `security`, `infra`, `data`, `tooling`
- risk / priority: `p0`, `p1`, `p2`, `p3`, `blocked`, `decision-needed`, `cutover-risk`, `truth-drift`, `external-dependency`
- work type: `build`, `refactor`, `delete`, `investigation`, `adr`, `spike`, `chore`
- ownership: `codex`, `claude`, `chatgpt`, `claude-os`

Note:
- workspace-level extra labels like `Feature`, `Bug`, and `Improvement` may also exist; do not let them become the primary operating labels for this team unless intentionally adopted

### Projects

Current intended project states:
- `UTV2-R1 Foundation` - `Completed`
- `UTV2-R2 Contracts` - `Completed`
- `UTV2-R3 Core Pipeline` - `Completed`
- `UTV2-R4 Distribution` - `Completed`
- `UTV2-R5 Settlement` - `In Progress`
- `UTV2-R6 Operator Control` - `Completed`
- `UTV2-R7 Migration` - `In Progress`
- `UTV2-R8 Hardening` - `Backlog`

### Milestones

Current intended milestone states:
- `UTV2-M1 Ratified Contracts` - complete
- `UTV2-M2 Canonical Schema Live` - complete
- `UTV2-M3 Submission Path Live` - complete
- `UTV2-M4 Lifecycle Enforced` - complete
- `UTV2-M5 Discord Post End-to-End` - complete
- `UTV2-M6 Settlement End-to-End` - in progress
- `UTV2-M7 Operator Control v1` - complete
- `UTV2-M8 Cutover Ready` - not started

### Current Active Issues

These should be the real active work surfaces unless repo truth changes:
- `UTV2-28` Week 16 verification / closeout
- `UTV2-23` migration ledger

These should remain visible but not active implementation:
- `UTV2-29` accepted salvage through Batch 5 - `Done`
- `UTV2-30` Batch 4 queue record - `Done`
- `UTV2-31` Batch 5 final salvage execution - `Done`
- `UTV2-26` / `UTV2-27` hardening backlog - `Backlog`

### Current Repo Truth That Linear Must Match

- Week 16 is still open
- Week 16 runtime integration is complete
- Accepted Week 16 foundation includes Batch 1 through Batch 5
- Repo gates currently pass at `491/491` tests, lint clean, type-check clean, build clean
- Batch 5, the final salvage slice, is now complete

Primary authority:
- `docs/06_status/status_source_of_truth.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/next_build_order.md`
- `docs/04_roadmap/active_roadmap.md`

---

## Work Already Done

The following Linear alignment work has already been performed and should be preserved:

- team / projects / milestones / labels exist
- historical seed issues were normalized so completed work is not still sitting in backlog
- project descriptions were updated to reflect current reality
- control-link documents were created:
  - `UTV2 Control Links`
  - `UTV2-R5 Current Reality`
  - `UTV2-R7 Current Reality`
  - `UTV2 Suggested Views`
- current active issue state was updated for Week 16 and migration
- Batch 4 queue history and Batch 5 execution issue were normalized in Linear

Do not redo that work from scratch. Build on it.

---

## Remaining Finish Work

These are the parts that still need a stronger Linear pass.

### 1. Add Saved Views In The Linear UI

Create these saved team views.

#### View 1 - Active Truth Work

- Team: `UTV2`
- Status: `In Progress`
- Order: updated descending
- Purpose: show only the real current workstreams

#### View 2 - Week 16 Closeout

- Team: `UTV2`
- Project: `UTV2-R5 Settlement`
- Status: not `Done`
- Labels include one or more of:
  - `settlement`
  - `testing`
  - `truth-drift`
- Purpose: isolate Week 16 verification and closeout work

#### View 3 - Migration Queue

- Team: `UTV2`
- Project: `UTV2-R7 Migration`
- Status: not `Done`
- Order:
  - priority ascending
  - updated descending
- Purpose: show current migration work, accepted salvage history, and queued next slice
- Purpose: show current migration work, accepted salvage history, and the final active slice

#### View 4 - Hardening Backlog

- Team: `UTV2`
- Project: `UTV2-R8 Hardening`
- Status: `Backlog`
- Purpose: keep cutover-prep work visible without mixing it into the current active lane

#### View 5 - Truth Drift / Decisions Needed

- Team: `UTV2`
- Labels include one or more of:
  - `truth-drift`
  - `decision-needed`
  - `blocked`
- Status: not `Done`
- Purpose: surface items that threaten alignment with repo authority

#### View 6 - Completed Milestone History

- Team: `UTV2`
- Status: `Done`
- Order: completed descending
- Purpose: compact closed-work history for audits and status reviews

### 2. Add Project Pulse / Status Updates

If Linear project pulse / status updates are available in the UI, add or refresh them for:
- `UTV2-R5 Settlement`
- `UTV2-R7 Migration`
- optionally `UTV2-R8 Hardening`

Recommended pulse content:

#### `UTV2-R5 Settlement`

- Status: `In Progress`
- Health: `onTrack`
- Summary:
  - Week 16 runtime integration is complete
  - accepted foundation includes Batch 1 through Batch 5
  - project remains open only because independent verification and closeout truth are still pending
  - current gates are `491/491` tests, lint clean, type-check clean, build clean

#### `UTV2-R7 Migration`

- Status: `In Progress`
- Health: `onTrack`
- Summary:
  - migration ledger remains active
  - accepted salvage through Batch 5 is recorded
  - Batch 5 execution is complete and should remain visible as closed history

#### `UTV2-R8 Hardening`

- Status: `Backlog` or equivalent
- Health: `onTrack`
- Summary:
  - hardening work is intentionally not active yet
  - cutover-risk issues exist but should not widen current scope

### 3. Create Initiatives If The Workspace Uses Them

If initiatives are enabled and useful in this workspace, create these:

#### Initiative A - Runtime Closeout

- Name: `UTV2-I1 Runtime Closeout`
- Status: `Active`
- Projects:
  - `UTV2-R5 Settlement`
  - `UTV2-R7 Migration`
- Purpose:
  - tie Week 16 verification and migration truth together without widening into new implementation

#### Initiative B - Cutover Readiness

- Name: `UTV2-I2 Cutover Readiness`
- Status: `Planned`
- Projects:
  - `UTV2-R7 Migration`
  - `UTV2-R8 Hardening`
- Purpose:
  - hold future cutover work above the project level without making it look active yet

If initiatives feel like unnecessary overhead for this workspace, skip them deliberately and record that decision in Linear or Notion rather than half-adopting them.

### 4. Tighten Project Resources

Ensure these project resources are attached or easily reachable:

#### `UTV2-R1 Foundation`

- `UTV2 Control Links`
- `UTV2 Suggested Views`

#### `UTV2-R5 Settlement`

- `UTV2-R5 Current Reality`
- repo authority links back to Week 16 contract and status docs

#### `UTV2-R7 Migration`

- `UTV2-R7 Current Reality`
- migration cutover plan reference

### 5. Confirm Team Workflow Settings

Check in the Linear UI:
- first started state is `In Progress`
- first unstarted state is `Ready` or `Todo` according to team preference
- `Done` is the actual completed terminal state
- blocked work uses the `Blocked` started state and not a label-only workaround

If there are duplicate or unused workflow states that confuse the operating model, simplify them.

### 6. Verify Git Integration Readiness

This cannot be considered finished until Git workflow is truly usable.

Check in the Linear UI:
- GitHub integration is enabled for the real repo
- repo connected: `griff843/Unit-Talk-v2`
- branch copy behavior uses the Linear issue ID
- optional preferences enabled:
  - auto-assign to self on branch copy
  - move issue to first started state on branch copy

Important:
- at the repo level, real commit history still needs to exist before PR linkage becomes truly operational
- do not mark Git integration "done" just because the repo URL is known

---

## Things Not To Do

- do not reopen closed historical work just because it predates the current cleanup pass
- do not widen beyond Week 16 verification and closeout from within a Linear housekeeping session
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
- repo docs, Linear, and Notion all tell the same Week 16 story

---

## Suggested Claude Prompt

Use this prompt if handing the remaining UI-only work to Claude:

> Finish the `unit-talk-v2` Linear workspace using `docs/05_operations/linear_setup.md` and `docs/05_operations/linear_finish_pack.md`. Do not rebuild the workspace from scratch. Preserve the existing aligned issue/project state, add the saved views listed in the finish pack, add project pulse/status updates for the active projects, add initiatives only if they help rather than add overhead, verify GitHub integration readiness in the Linear UI, and keep Linear aligned with the repo authority docs under `docs/06_status/` and `docs/04_roadmap/active_roadmap.md`. Before making any UI-only changes, confirm the finish pack still matches the latest repo truth.
