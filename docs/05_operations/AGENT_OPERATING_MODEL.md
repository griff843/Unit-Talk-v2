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
