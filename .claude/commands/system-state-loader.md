# /system-state-loader

Load current system state before acting. Run at the start of every session and after every `/clear`.

Never assume state from memory. Always verify from live sources.

---

## When to invoke

- Start of every session
- After `/clear`
- After a context reset
- When Linear state conflicts with what you remember

---

## Step 1 — Run health check and ops brief

```bash
pnpm ops:health   # fast drift check: lanes, worktrees, branches, status docs
pnpm ops:brief    # point-in-time snapshot: Linear queue, GitHub, pipeline
```

Run `ops:health` first. If it reports BLOCKED, resolve before proceeding.
Run `ops:brief` for the full queue and runtime snapshot.

If any active lanes exist from a previous session, check them before starting new work:

```bash
pnpm lane:list                          # see what's active
pnpm lane:resume -- --issue UTV2-XXX   # restore context for an in-progress lane
```

`ops:health` surfaces:
- Active lane health (snapshot freshness, merged-but-still-active, capacity)
- Orphaned worktrees not in the lane registry
- Unregistered feat/* branches older than 3 days
- PROGRAM_STATUS.md staleness vs last commit

`ops:brief` surfaces:
- Current branch and last commit
- Linear queue state (Ready / In Progress / In Review)
- Runtime health indicators
- Any pending proof inputs

If either command fails or errors, diagnose before proceeding. Do not work blind.

---

## Step 2 — Read the Linear queue

Using `pnpm linear:work` or the Linear MCP, read all issues in:
- **Ready** — candidate for execution
- **In Progress** — active work, may need reconciliation
- **In Review** — PRs open, check if merged

For each issue note:
- ID and title
- Current state
- Assignee (Claude lane vs Codex lane)
- PR link if present

---

## Step 3 — Reconcile against repo truth on main

For every In Progress or In Review issue:

```bash
pnpm github:current
```

Check:
- Is the PR already merged? → mark Linear issue Done
- Is the branch stale or abandoned? → mark blocked, note reason
- Does the code on main already include the work? → mark Done without a PR if merged directly

Do not leave stale In Progress issues sitting. Reconcile them before building an execution batch.

---

## Step 4 — Read the program status doc

Read `docs/06_status/PROGRAM_STATUS.md`.

Answer:
- What is the active milestone?
- What is the current test count baseline?
- What open risks exist?
- What live routing is active?

If the file is out of date or contradicts repo truth on main, note the discrepancy. Do not update it here — that happens at sprint close.

---

## Step 5 — Answer the three questions

Before touching any code or creating any Linear issues, explicitly answer:

1. **What milestone is active?**
2. **What Linear issues are executable right now?**
3. **What is blocked and why?**

If any of these is unclear, stop and resolve it before acting. Do not start work with ambiguous state.

---

## Decision: proceed or stop

**Proceed** when:
- Milestone is clear
- At least one executable issue exists
- No stale In Progress states conflict with current repo truth

**Stop and resolve** when:
- Linear state conflicts with repo truth on main
- Active milestone is unclear
- A T1 issue has no contract
- Baseline on main is failing (`pnpm test` red)

If stopping: state exactly what is unclear and what must be resolved before execution can begin.

---

## Output format

```
## System State — <date>

### ops:brief result
<paste key output or note if it errored>

### Linear queue
| ID | Title | State | Lane | PR |
|----|-------|-------|------|----|
| UTV2-XXX | ... | Ready | Claude | — |

### Reconciliation
- <ID>: merged → marked Done
- <ID>: stale In Review → flagged blocked (reason)
- All others: state matches repo truth

### Active milestone
<milestone name and goal>

### Executable issues
- <list or NONE>

### Blocked issues
- <list with exact blocker or NONE>

### Decision
PROCEED with: <issue list>
— or —
STOP: <exact reason>
```
