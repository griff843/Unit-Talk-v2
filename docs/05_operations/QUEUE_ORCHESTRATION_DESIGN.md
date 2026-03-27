# Unit Talk V2 — Queue + Orchestration System Design

> **Status:** RATIFIED — this doc is the canonical authority for the queue/orchestration system
> **Owner:** Claude (governance); Codex (implementation of queue tooling)
> **Produced:** 2026-03-26
> **Authority chain:** This doc → `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Executive Summary

The Unit Talk V2 development loop currently runs as session-driven bursts: a human opens a session, assigns tasks, waits for completion, then assigns the next. This creates idle time between sessions, no durable work queue, and no machine-readable state.

The queue-driven model replaces this with:

- A durable, repo-local queue (`docs/06_status/ISSUE_QUEUE.md`) that any agent can read without human intervention
- One issue = one branch = one PR — fully traceable from intent to merge
- Three warm lanes running concurrently (Claude governance, Codex implementation, Augment bounded support)
- Fail-closed state machine that prevents unauthorized or missequenced work
- A design that starts repo-local and connects to Linear/GitHub Actions without structural change

**The system does not replace the sprint model.** T1 contracts, proof bundles, and closeout discipline remain. The queue is a workflow surface on top of those governance rules — it does not relax them.

---

## 2. Core Principles

1. **Queue first.** Work is not assigned verbally. It is selected from the queue by priority and dependency truth.
2. **Explicit ownership.** Every issue is owned by exactly one lane (claude / codex / augment). No ambiguity.
3. **Fail closed.** A blocked dependency, missing contract, or failing verify halts the lane — it does not get skipped.
4. **Governance stays with Claude.** No T1 item merges without Claude review. No contract is ratified by an implementing agent.
5. **One T1 at a time.** The active T1 implementation lane is singular. Running two concurrent T1 schema/write-path lanes is a governance violation.
6. **Runtime leads docs.** The queue reflects what is true in the repo — not what is intended.

---

## 3. Queue Model

### 3.1 Queue Location

Primary (repo-local): `docs/06_status/ISSUE_QUEUE.md`

Secondary (later, non-breaking): Linear project `UTV2`, issues mirrored from the queue doc.

The repo-local file is the source of truth until Linear sync is explicitly automated. On conflict, the repo-local file wins.

### 3.2 Issue Fields

Every issue in the queue must define:

```markdown
## [UTV2-N] Issue Title

| Field | Value |
|---|---|
| **ID** | UTV2-N |
| **Tier** | T1 / T2 / T3 / DOCS |
| **Lane** | codex / claude / augment |
| **Status** | READY / IN_PROGRESS / IN_REVIEW / BLOCKED / DONE / DEFERRED |
| **Milestone** | M1–M8 or — |
| **Area** | api / discord-bot / operator-web / ingestor / db / governance / contracts |
| **Blocked by** | UTV2-N, UTV2-M (or —) |
| **Unlocks** | UTV2-N, UTV2-M (or —) |
| **Branch** | codex/UTV2-N-slug (set when IN_PROGRESS) |
| **PR** | #N (set when IN_REVIEW) |

### Acceptance Criteria

- [ ] AC-1: ...
- [ ] AC-N: ...

### Proof Requirements

- [ ] `pnpm verify` exits 0; test count ≥ N
- [ ] Live proof: ...

### Contract Authority

`docs/05_operations/<CONTRACT>.md` (T1 only — required before work begins)
```

### 3.3 Status Values

| Status | Meaning | Entry Condition |
|---|---|---|
| `READY` | All deps closed; can start | All `Blocked by` issues are `DONE` |
| `IN_PROGRESS` | Assigned agent is working | Agent claimed the issue; branch created |
| `IN_REVIEW` | PR open; awaiting Claude review | `pnpm verify` exit 0; PR created |
| `BLOCKED` | Cannot start; dependency missing | Any `Blocked by` issue is not `DONE` |
| `DONE` | Merged; verified; closed | Claude approved merge; PR merged |
| `DEFERRED` | Intentionally not next | Operator decision; not blocked but not ready |
| `DOCS-ONLY` | Governance/spec work; no implementation | Claude lane only; no branch required |

### 3.4 Priority Ordering

Within a lane, issues are prioritized:

1. `IN_REVIEW` — already in review; complete before starting new work
2. `READY` — highest tier first (T1 > T2 > T3), then lowest UTV2-N number
3. `BLOCKED` — monitor for blocker removal; do not start

### 3.5 Dependency Rules

- A `READY` issue whose `Blocked by` list is not fully `DONE` is **invalid** — move it to `BLOCKED`
- Before claiming an issue, the agent must verify each `Blocked by` issue is marked `DONE` in the queue
- Circular dependencies are forbidden; Claude must detect and reject them during contract authoring
- T1 issues may only depend on other T1 or completed T2/T3 items — never on pending T2/T3 items

---

## 4. Label Taxonomy

These labels apply in both the repo-local queue and Linear.

### Lane Labels (ownership — required on every issue)

| Label | Meaning |
|---|---|
| `lane:claude` | Claude is the assigned agent (governance, verification, contracts) |
| `lane:codex` | Codex is the assigned agent (implementation, migration, tests) |
| `lane:augment` | Augment is the assigned agent (bounded T2/T3/support) |

### Tier Labels (risk — required on every issue)

| Label | Meaning |
|---|---|
| `tier:T1` | New migration + write-path change + proof bundle required |
| `tier:T2` | Additive; no migration; no settlement/promotion path change |
| `tier:T3` | Pure compute/config/tooling; no DB or write-path touch |
| `tier:DOCS` | Governance/spec only; no runtime change |

### Status Labels (workflow state — required on every issue)

| Label | Meaning |
|---|---|
| `status:ready` | Ready to start; all deps met |
| `status:in-progress` | Agent is working |
| `status:in-review` | PR open; waiting for Claude review |
| `status:blocked` | Dependency missing |
| `status:done` | Merged and closed |

### Milestone Labels (optional but recommended)

`milestone:M1` through `milestone:M8` corresponding to Linear milestones UTV2-M1 through UTV2-M8.

### Area Labels (optional — for filtering)

| Label | Covers |
|---|---|
| `area:api` | `apps/api` |
| `area:discord-bot` | `apps/discord-bot` |
| `area:operator-web` | `apps/operator-web` |
| `area:ingestor` | `apps/ingestor` |
| `area:db` | `packages/db`, migrations |
| `area:domain` | `packages/domain` |
| `area:contracts` | `packages/contracts` |
| `area:governance` | docs, contracts, specs |
| `area:tooling` | scripts, CI, queue infrastructure |

---

## 5. State Machine

```
            ┌─────────────────────────────────────────┐
            │                                         │
  [Author]──┤  BLOCKED ────────────────► READY ──────┤
            │    │                         │          │
            │    │  dep removed            │  claim   │
            │    │                         ▼          │
            │    └──────────────────► IN_PROGRESS     │
            │                             │           │
            │                             │  verify   │
            │                             │  exit 0   │
            │                             ▼           │
            │                        IN_REVIEW ───────┤
            │                             │           │
            │          Claude approve     │           │
            │               ──────────────►  DONE     │
            │          Claude reject      │           │
            │               ──────────────► READY     │
            │          Claude requeue     │           │
            │               ──────────────► BLOCKED   │
            │                                         │
            │  Any state ─────────────► DEFERRED      │
            │  (operator decision only)               │
            └─────────────────────────────────────────┘
```

### Transition Rules

| From | To | Actor | Condition |
|---|---|---|---|
| `BLOCKED` | `READY` | Automated / Claude | All `Blocked by` items reach `DONE` |
| `READY` | `IN_PROGRESS` | Codex / Augment | Agent claims issue; creates branch |
| `IN_PROGRESS` | `IN_REVIEW` | Codex / Augment | `pnpm verify` exit 0; PR opened |
| `IN_REVIEW` | `DONE` | Claude | Code review approved; PR merged |
| `IN_REVIEW` | `READY` | Claude | Rejected — fixable; agent re-opens |
| `IN_REVIEW` | `BLOCKED` | Claude | Rejected — dependency gap found |
| Any | `DEFERRED` | Operator only | Explicit deferral decision |
| `DONE` | (none) | — | Terminal; never reopen |

---

## 6. Branch Naming Rules

```
<lane>/<issue-id>-<short-slug>
```

Examples:
```
codex/UTV2-28-automated-grading
codex/UTV2-30-sgo-results-ingest
augment/UTV2-34-deploy-commands-verify
claude/UTV2-32-stats-t2-contract
```

Rules:
- `<lane>` = `codex`, `claude`, or `augment` — matches `lane:*` label exactly
- `<issue-id>` = `UTV2-N` exactly
- `<short-slug>` = 2–5 words, hyphen-separated, lowercase, no special chars
- Branch is created when issue transitions `READY → IN_PROGRESS`
- Branch must not exist before issue is claimed
- Agents never push to `main` directly — always via PR

---

## 7. PR Naming and Rules

### PR Title Format

```
[T1] Issue title (UTV2-N)
[T2] Issue title (UTV2-N)
[T3] Issue title (UTV2-N)
[DOCS] Issue title (UTV2-N)
```

### PR Body Requirements

Every PR must include:

```markdown
## Issue

Closes UTV2-N

## Summary

- What was changed (files, functions, key decisions)
- What was NOT changed (explicit non-goals)

## Verify Output

pnpm verify — exit N
Tests: N/N passing

## Acceptance Criteria

- [x] AC-1: ...
- [x] AC-N: ...

## Proof (T1 only)

- [ ] Live DB proof: ...
- [ ] End-to-end flow: ...

## Claude Review Checklist

- [ ] Tier matches scope of change (no T2 with a migration)
- [ ] No writes to settlement path without T1 contract
- [ ] No new Discord targets without a ratified contract
- [ ] Test count did not decrease
- [ ] `pnpm verify` exit 0 confirmed
```

### PR Merge Rules

| Rule | Detail |
|---|---|
| Claude approval required | Every PR on `main` branch requires Claude review. No self-merge by implementing agent. |
| `pnpm verify` must pass | The verify run output must be in the PR body or a linked CI artifact. |
| Test count monotonically non-decreasing | If tests decreased, PR is auto-rejected until explained and justified. |
| T1 requires proof | T1 PRs must include a filled proof section with live DB evidence before merge approval. |
| No scope creep | PR must not include changes not covered by the issue's acceptance criteria. Extras are extracted into new issues. |
| One issue per PR | Multi-issue PRs are rejected unless explicitly approved by Claude before branching. |
| Issue must be linked | `Closes UTV2-N` in PR body is required. Without it, the PR is not reviewed. |

---

## 8. Codex Async Loop Protocol

This protocol defines how Codex selects, claims, implements, and closes issues without requiring a human session.

### Step 1 — Queue Read

```
Read: docs/06_status/ISSUE_QUEUE.md
Read: docs/06_status/PROGRAM_STATUS.md (verify no active T1 conflict)
Read: docs/05_operations/SPRINT_MODEL_v2.md (tier rules)
```

### Step 2 — Issue Selection

Codex selects the highest-priority READY issue in `lane:codex`:

1. Confirm all `Blocked by` issues are `DONE` in the queue
2. Confirm no other T1 lane is `IN_PROGRESS` if the candidate is T1
3. Confirm the T1 contract exists (for T1 issues) and is ratified (not DRAFT)

If no READY codex issue exists → report to operator. Do not start unqueued work.

### Step 3 — Branch Creation

```bash
git checkout main
git pull origin main
git checkout -b codex/UTV2-N-<slug>
```

### Step 4 — Queue Update

Update `docs/06_status/ISSUE_QUEUE.md`:
- Status: `IN_PROGRESS`
- Branch: `codex/UTV2-N-<slug>`

Commit the queue update on the feature branch (not a separate commit on main).

### Step 5 — Implementation

Follow the issue's Acceptance Criteria and Contract exactly. At every step:
- Scope to the files listed in the contract
- Do not touch files outside the contract scope without updating the queue with a scope note
- Do not widen the issue

### Step 6 — Verify

```bash
pnpm verify
```

Must exit 0. If it fails:
- Do not push the branch
- Fix the issue
- Re-run verify
- If unfixable in one session: leave branch in progress, report blocker in queue issue

### Step 7 — PR Creation

```bash
git push origin codex/UTV2-N-<slug>
gh pr create --title "[T1] Issue title (UTV2-N)" --body "..."
```

PR body must include all required sections (see §7).

### Step 8 — Queue Update

Update `docs/06_status/ISSUE_QUEUE.md`:
- Status: `IN_REVIEW`
- PR: `#N`

Commit on feature branch (PR already open — amend or add a follow-up commit on branch).

### Step 9 — Hand Off

Codex stops. Claude takes over in the next session. Codex does NOT self-merge.

### Step 10 — Next Issue

After handing off to IN_REVIEW, if another READY codex issue exists that does not conflict with the in-review item, Codex may open a second branch and start work. This is permitted only for T2/T3 (never T1 when another T1 is IN_REVIEW).

---

## 9. Claude Session Protocol

### On Session Start

```
1. Read PROGRAM_STATUS.md
2. Read ISSUE_QUEUE.md
3. Identify IN_REVIEW items → review first
4. Identify BLOCKED items whose blockers are now DONE → promote to READY
5. Identify governance gaps → draft contracts for next READY lanes
```

### Review Checklist (for each IN_REVIEW item)

1. PR body complete (all sections filled)
2. `pnpm verify` output confirms exit 0 and correct test count
3. All acceptance criteria checked
4. T1: proof section filled with live evidence
5. No scope creep vs. the issue's AC
6. No changes to files outside the stated contract scope
7. No new Discord targets without contract
8. No settlement path changes without T1 authorization

### Decision Outcomes

| Decision | Action |
|---|---|
| **Approve** | Merge PR (or approve for Codex to merge); mark issue `DONE`; update PROGRAM_STATUS; promote unblocked issues to `READY` |
| **Reject — fixable** | Comment with specific failures; mark issue back to `READY`; Codex re-opens branch |
| **Reject — blocked** | Mark issue `BLOCKED`; specify the missing contract or dependency |

### Contract Drafting (parallel to review)

While a Codex T1 lane is IN_PROGRESS, Claude's job is:
- Draft the next T1 contract so it's ready when the current lane closes
- Ratify pending T2 DRAFT contracts if blockers have cleared
- Update the queue to reflect new READY items

Claude does not implement. If Claude modifies a runtime file during a governance session, that is a lane violation.

---

## 10. Augment Lane Policy

### What Augment Can Own

- Issues tagged `lane:augment`
- Tier: T2 or T3 only — never T1
- Scope: bounded to files not in active Codex T1 lane
- One issue at a time (Augment is session-bound; no persistent loop)

### What Augment Cannot Do

- Start a T1 implementation lane
- Modify `packages/db/src/database.types.ts` (generated — only `pnpm supabase:types`)
- Touch `apps/api/src/settlement-service.ts`, `promotion-service.ts` without explicit T1 authorization
- Claim an issue tagged `lane:codex` or `lane:claude`
- Self-ratify a contract
- Merge a PR

### Augment Loop (Per Session)

1. Read `ISSUE_QUEUE.md`
2. Find highest-priority READY `lane:augment` issue
3. Confirm no file-level conflict with active Codex lane
4. Create branch `augment/UTV2-N-<slug>`
5. Implement to AC
6. Run `pnpm type-check` + `pnpm test` (subset — never full pnpm verify unless explicitly required by the issue)
7. Push branch, open PR
8. Mark issue `IN_REVIEW`
9. Stop — Claude reviews

### Augment Anti-Idle Rule (Parallel Queuing Obligation)

**Claude must queue at least one `lane:augment` READY issue at the same time a Codex T2/T1 lane is opened or ratified.**

| Rule | Detail |
|------|--------|
| Timing | Augment issue is queued in `ISSUE_QUEUE.md` simultaneously with Codex issue being set to READY — not after Augment is observed idle |
| Parallel-safe | Augment issue must not touch files in the active Codex lane's contract scope |
| Mechanism | Queue only — verbal or reactive assignment is a process violation |
| No work identified | If no parallel-safe T3 work exists, Claude notes this explicitly in the queue comment; Augment remains idle by documented decision, not by default |

**Rationale:** Augment idles when no queued issue exists to pull. Reactive assignment after noticing idleness wastes a full implementation cycle. Pre-loading one Augment issue per Codex lane open eliminates the gap with zero coordination overhead.

---

## 11. Fail-Closed Rules

### Rule F-1: Authority Conflict

If a PR or implementation contradicts a ratified contract:
- PR is immediately rejected
- Issue moves to `BLOCKED`
- Claude must author a clarifying amendment before re-opening

### Rule F-2: Missing T1 Contract

If a T1 issue is `IN_PROGRESS` without a ratified contract in `docs/05_operations/`:
- Immediately halt implementation
- Move issue back to `BLOCKED`
- Claude authors the contract; issue moves to `READY` only after ratification

### Rule F-3: Dependency Not Closed

If an issue is `IN_PROGRESS` and a `Blocked by` dependency is found to be not `DONE`:
- Halt implementation
- Move issue back to `BLOCKED`
- Do not undo already-committed work unless it conflicts with the outstanding dependency

### Rule F-4: Verify Failure

If `pnpm verify` fails during Codex implementation:
- Do not push the branch
- Do not open a PR
- Fix the failure or report the blocker in the queue issue comment
- Issue stays `IN_PROGRESS` until verify exits 0

### Rule F-5: Unrelated Repo Failure

If `pnpm verify` fails due to a pre-existing, unrelated failure:
- Document the exact failure
- Do not proceed with the implementation PR
- Escalate to Claude: is this a pre-existing issue that was already known?
- If confirmed pre-existing and isolated: Claude may waive for the specific PR with a written note

### Rule F-6: Two T1 Lanes

If two T1 issues are simultaneously `IN_PROGRESS`:
- The lower-priority one is immediately moved back to `READY`
- Its branch is preserved but not continued until the first T1 closes
- Claude notes the violation in PROGRAM_STATUS

### Rule F-7: Unqueued Work

If an agent starts implementation work not represented in `ISSUE_QUEUE.md`:
- Work is halted
- A new issue is authored for it
- The issue goes through normal queue entry (BLOCKED / READY check)
- Exception: trivial fixes (<5 lines, no new behavior) may be included in the active issue with a scope note

---

## 12. Definition of Done

An issue is `DONE` when all of the following are true:

| Criterion | Required For |
|---|---|
| PR merged to `main` | All tiers |
| `pnpm verify` exits 0 post-merge | All tiers |
| Test count ≥ pre-issue count | All tiers |
| All acceptance criteria checked | All tiers |
| Queue updated: status = DONE | All tiers |
| PROGRAM_STATUS.md updated | All tiers |
| Unblocked issues promoted to READY | All tiers |
| T2+ contracts updated (if state changed) | T1, T2 |
| Proof bundle captured | T1 only |
| Linear issue marked Done | T1, T2 (when synced) |

---

## 13. Implementation Plan for Codex

Codex implements the queue tooling as a distinct issue (`UTV2-36`). The sequence:

### Phase 1 — Queue Document (no tooling, immediate)

1. Create `docs/06_status/ISSUE_QUEUE.md` with the first 10 issues formatted per the spec in §3.2
2. Each issue includes all required fields, status, lane, tier, dependencies
3. Verify format is parseable (no broken markdown tables)

### Phase 2 — Label and Template Setup

4. Create `docs/templates/issue-template.md` — the canonical issue template
5. Create `.github/ISSUE_TEMPLATE/unit-talk-issue.md` — GitHub issue template version
6. Create `.github/PULL_REQUEST_TEMPLATE.md` — PR template with all required sections

### Phase 3 — Queue Helper Script

7. Create `scripts/queue-status.mjs` — read-only queue reporter
   - Parses `ISSUE_QUEUE.md`
   - Prints: current READY issues per lane, IN_PROGRESS issues, IN_REVIEW issues, blocked issues
   - Output: plain text table
   - Exit 0 always (read-only)

8. Create `scripts/claim-issue.mjs` — issue claim helper
   - Args: `--issue UTV2-N --lane codex`
   - Validates: issue exists, status is READY, lane matches, deps are DONE
   - Updates `ISSUE_QUEUE.md`: status → IN_PROGRESS, branch → `<lane>/UTV2-N-<slug>`
   - Creates the git branch
   - Prints branch name

9. Create `scripts/submit-issue.mjs` — issue submission helper
   - Args: `--issue UTV2-N --pr 42`
   - Updates `ISSUE_QUEUE.md`: status → IN_REVIEW, PR → #42
   - Prints next READY issue in the lane

### Phase 4 — Linear Sync (later, after Phase 1–3 are stable)

10. Linear webhook or cron sync from `ISSUE_QUEUE.md` → Linear project UTV2
    - Bidirectional: status changes in Linear propagate back
    - This is a T3 task; does not block Phase 1–3

---

## 14. Codex Implementation Sequence (UTV2-36)

When Codex picks up issue `UTV2-36 — Queue Tooling Buildout`:

```
Step 1: Read this doc fully
Step 2: Read ISSUE_QUEUE.md (already populated by Claude from this design session)
Step 3: Create docs/templates/issue-template.md
Step 4: Create .github/ISSUE_TEMPLATE/unit-talk-issue.md
Step 5: Create .github/PULL_REQUEST_TEMPLATE.md
Step 6: Create scripts/queue-status.mjs (Node ESM, no deps beyond node:fs + node:path)
Step 7: Test queue-status.mjs against ISSUE_QUEUE.md — verify it prints correct output
Step 8: Create scripts/claim-issue.mjs
Step 9: Test claim-issue.mjs in dry-run mode
Step 10: Create scripts/submit-issue.mjs
Step 11: pnpm verify — exit 0
Step 12: PR per §7 format
```

No new packages. No new DB tables. No API changes. Scripts use Node ESM (same pattern as `scripts/generate-types.mjs`).

---

## 15. File Index (All Artifacts This Design Produces)

| File | Type | Created by |
|---|---|---|
| `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` | Master design | Claude (this session) |
| `docs/06_status/ISSUE_QUEUE.md` | Live queue | Claude (this session) |
| `docs/templates/issue-template.md` | Template | Codex (UTV2-36) |
| `.github/ISSUE_TEMPLATE/unit-talk-issue.md` | GitHub template | Codex (UTV2-36) |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR template | Codex (UTV2-36) |
| `scripts/queue-status.mjs` | Queue reporter | Codex (UTV2-36) |
| `scripts/claim-issue.mjs` | Claim helper | Codex (UTV2-36) |
| `scripts/submit-issue.mjs` | Submit helper | Codex (UTV2-36) |

---

## 16. References

- `docs/06_status/PROGRAM_STATUS.md` — wins on conflict
- `docs/05_operations/SPRINT_MODEL_v2.md` — tier requirements
- `docs/05_operations/docs_authority_map.md` — authority tiers
- `docs/06_status/ISSUE_QUEUE.md` — the live queue
- `CLAUDE.md` — session start checklist and lane discipline
