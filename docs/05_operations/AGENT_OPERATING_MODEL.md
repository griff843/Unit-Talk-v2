# Agent Operating Model

> **Status:** Active authority. Adopted 2026-03-28. Supersedes `agent_delegation_policy.md`.
> **Authority tier:** Tier 4 — Operating Policy
> **Owner:** Program Owner

---

## Core Principle

**Linear is the control plane. Chat is not.**

Issues are the unit of work. Agents execute issues. Agents report to Linear. Chat is for blockers and decisions only — not for progress updates, status narration, or routing narration.

---

## Roles

### PM / Operator

- Creates issues in Linear with explicit lane, tier, and scope
- Assigns issues to agents
- Reads Linear for execution status
- Uses chat only to unblock agents or make a decision they cannot make themselves

### Claude

- Executes `lane:claude` issues
- Reads the assigned Linear issue as the authoritative scope document
- Updates Linear when the issue is in progress, blocked, or done
- Updates repo docs only when the issue explicitly requires it
- Does NOT orchestrate Codex or Augment unless the issue scope explicitly includes that
- Does NOT narrate routing decisions in chat — executes directly

### Codex

- Executes `lane:codex` issues
- Reads the contract / spec linked from the Linear issue
- Pushes code to a branch named `codex/{LINEAR_ID}-{slug}`
- Opens a PR and links it in the Linear issue
- Does NOT start work before the contract is ratified

### Augment

- Executes `lane:augment` issues
- Same branch/PR discipline as Codex

---

## Linear-First Reporting

All execution state lives in Linear. The issue is the record.

| Event | Action |
|-------|--------|
| Agent starts work | Set issue status → **In Progress** |
| Agent hits a blocker | Comment in Linear with precise blocker description; use chat only if a decision is required immediately |
| Agent completes work | Set issue status → **Done**; add concise completion summary as Linear comment or description update |
| Agent opens a PR | Link PR in the Linear issue |
| Agent needs a decision | Escalate to chat with a single clear question |

**Do not narrate progress in chat.** Progress belongs in Linear. Chat should carry only: blockers, decision requests, and the word "done."

---

## What Belongs Where

| Content | Where it lives |
|---------|---------------|
| Execution status (in progress, done, blocked) | Linear |
| PR links | Linear |
| Completion summaries | Linear (issue description or comment) |
| Blockers requiring a decision | Chat (one escalation per blocker) |
| Proof artifacts | `out/sprints/` in repo (gitignored) |
| Runtime capability truth | `docs/06_status/PROGRAM_STATUS.md` |
| Active work queue | `docs/06_status/ISSUE_QUEUE.md` |
| Architecture contracts | `docs/02_architecture/contracts/` |
| Lane policy | this file |

---

## Repo Status Authority vs Linear Execution Board

These are separate systems with separate purposes.

| System | Purpose | Updated by |
|--------|---------|------------|
| `PROGRAM_STATUS.md` | High-level milestone, capabilities, open risks — the *what* of the program | T1/T2 sprint close only |
| `ISSUE_QUEUE.md` | Active work queue state — the *current state* of every open issue | Every lane state change |
| Linear | Execution board — issue lifecycle, assignments, PR links, completion evidence | Agents at every state change |

**Rule:** When `ISSUE_QUEUE.md` and Linear disagree, Linear wins and `ISSUE_QUEUE.md` must be updated to match.

**Rule:** `PROGRAM_STATUS.md` reflects only proven, merged capabilities. It is not a planning document.

## Branch Protection Baseline

The intended `main` branch baseline is:

- no direct pushes to `main`
- no force pushes to `main`
- human review required before merge
- current status checks required before merge, and those checks must represent repo truth rather than stale or advisory signals
- CODEOWNERS review required for owned paths where applicable

This document describes the intended baseline only. GitHub branch protection settings still need to be configured manually in the repository admin UI.

## Supabase Preview Branch Usage

Supabase preview-branch validation is not the default path for every migration PR. It is a cost-incurring, high-signal control and must be used only when needed.

Default rule:
- Do not rely on preview-branch validation for routine or low-risk migration work by default.

Use preview-branch validation only when one or more of the following is true:
- the PR is Tier C / T1
- the PR changes destructive or stateful schema behavior
- the PR introduces or modifies RPCs, constraints, triggers, or lifecycle-critical DB logic
- the PR includes backfill, cleanup, or corrective data-state logic
- the PR affects a path where InMemory vs Postgres divergence is a known risk
- PM explicitly requires isolated Supabase validation for this PR

Do not require preview-branch validation when:
- the change is docs-only
- the change is app/runtime-only with no migration
- the migration is low-risk and already covered by local verification plus manual review
- the expected safety benefit does not justify the preview-branch cost

Cost-control rules:
- Keep migration PRs small and tightly scoped
- Avoid repeated speculative pushes to migration PR branches
- Close or merge migration PRs promptly so preview branches are torn down quickly
- Prefer local verification first; escalate to preview-branch validation only for higher-risk cases

PM authority:
- PM may require preview-branch validation for any migration PR, but the default posture is selective use, not automatic use on every change

Current note:
- Until the preview-branch workflow is fully reliable, treat it as a selective safety gate, not a universal merge prerequisite

---

## Minimal Operator Workflow

```
PM creates issue in Linear (lane + tier + scope explicit)
  → Agent assigned reads issue
  → Agent sets status In Progress in Linear
  → Agent executes (no chat narration needed)
  → Agent sets status Done in Linear + links PR if applicable
  → PM reviews Linear; merges PR if required
  → Chat is used only if agent needs a decision or is blocked
```

One issue. One branch. One PR. One status update per state change.

---

## When Claude May Route to Codex or Augment

Claude does NOT auto-orchestrate. Claude only routes to another agent when:

1. The active issue explicitly says to dispatch another agent, OR
2. The PM explicitly instructs it in chat

If neither condition is met, Claude executes within its own lane.

---

## Batch Orchestration Pattern

When Codex is unavailable or the PM explicitly authorizes batch execution, Claude may orchestrate parallel worktree agents for codex-lane items.

**Rules:**
- Each agent gets one issue, one branch, one PR — no stacking
- Agents run in isolated worktrees (`isolation: worktree`) — no cross-contamination between agents or the main worktree
- Serial dependencies chain on merge: launch the next dependent agent when the merge notification arrives, not in advance
- Linear is updated per issue when PRs land — batch orchestration does not change reporting discipline
- Merge on green CI without ceremony delay — do not hold PRs waiting for a batch to complete

**When Codex is back online:** route issues to Codex directly. The batch orchestration path goes dormant. Nothing reverts — the model supports both modes.

**Operator authorization is required.** This pattern activates only when the PM explicitly says to run multiple issues in parallel. It is not a standing permission.

---

## When Repo Docs Are Updated

| Doc type | Updated when |
|----------|-------------|
| `PROGRAM_STATUS.md` | T1 or T2 sprint closes with a behavioral change |
| `ISSUE_QUEUE.md` | Every issue state change |
| Architecture contracts | Only when the contract changes materially — requires explicit issue scope |
| Operating model docs | Only when a governance issue in scope requires it |
| Proof artifacts | T1 proofs — written to `out/sprints/` (gitignored; not committed) |

**Do not update docs proactively.** Update only what the active issue requires.

---

## Anti-Patterns (Do Not Do These)

- Using chat to narrate what you just did or are about to do
- Auto-routing work to Codex or Augment without being told to
- Updating `PROGRAM_STATUS.md` on T3 work
- Updating Linear with vague status like "working on it" — be specific or don't update
- Treating a chat instruction as a contract — if it isn't in a ratified issue, it has no authority
- Starting implementation before the contract is ratified (T1 work)
- Creating new docs that don't map to a specific authority tier or issue requirement

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/05_operations/SPRINT_MODEL_v2.md` | Tier definitions and ceremony requirements |
| `docs/05_operations/docs_authority_map.md` | Authority tier chain |
| `docs/06_status/ISSUE_QUEUE.md` | Active work queue |
| `docs/06_status/PROGRAM_STATUS.md` | Program status authority |
| `docs/05_operations/agent_delegation_policy.md` | Superseded — see this file |
