# /linear-sync

Execute the core Linear work loop: read queue → reconcile → classify → execute → update Linear.

Linear is the only execution queue. Do not work on anything not in Linear or directly requested by the PM.

---

## When to invoke

- At the start of a work session (after `/system-state-loader`)
- After completing a lane to pick the next issue
- When asked to "work the queue" or "run the backlog"

---

## Step 1 — Read the queue

```bash
pnpm linear:work
```

Or via Linear MCP. Read all issues in:
- **Ready** — eligible for execution
- **In Progress** — may need reconciliation
- **In Review** — check if already merged

Record each issue: ID, title, state, assignee, PR link.

---

## Step 2 — Reconcile against repo truth

For each In Progress or In Review issue, check whether the work is already merged to main:

```bash
pnpm github:current
```

Apply these reconciliation rules:
- PR merged to main → mark Linear issue **Done**, attach merge commit
- PR open and CI green → confirm review is active, no action needed
- PR open and CI red → flag as blocked, note exact failure
- Branch exists but no PR → stale In Progress, flag and note
- Issue In Progress but no branch or PR → stale, reset to Ready or blocked

Do not leave stale states. Reconcile before building an execution batch.

---

## Step 3 — Classify each issue

Assign each executable issue to exactly one bucket:

### Claude-only
Use for:
- Cross-cutting refactors
- Shared contracts or types
- Shared route or repository changes
- Scoring, promotion, lifecycle logic
- Governance and status reconciliation
- Any issue with ambiguity
- Any issue that overlaps another active task
- Any T1 issue

### Codex-safe
Only when ALL are true:
- Issue exists in Linear with explicit scope
- Acceptance criteria are explicit
- Allowed files are explicit
- No migration
- No shared contract or type overlap with active work
- No overlapping routes or tests likely to collide
- Verification path is independent

### Blocked
- Missing upstream dependency
- Missing contract
- Ambiguous scope
- Conflicting active lane

### Needs reshaping
- Scope is too large or unclear to execute safely
- Acceptance criteria are missing
- Stop and report — do not start

---

## Step 4 — Build execution batch

**Concurrency rules:**
- Claude may execute one complex lane directly
- Codex may run at most 2 parallel lanes at a time
- Do not exceed 2 Codex lanes unless all active tasks are fully isolated by app and file scope
- Serial chains: launch the next only on merge notification, not in advance

For Codex-safe issues, generate the full task packet using the template from CLAUDE.md before dispatching. Do not give Codex vague work.

---

## Step 5 — Execute

For Claude-only issues: implement directly.

For Codex-safe issues: dispatch with `isolation: worktree`, one agent per issue, one branch per issue, one PR per issue — no stacking.

Required checks before merge (minimum):
```bash
pnpm type-check
pnpm test
```

Plus issue-specific verification commands from the task packet.

Merge policy:
- T3 / docs / isolated UI: merge on green
- T2 isolated logic: review diff, verify green, then merge
- T1 / migrations / runtime routing / shared contracts: explicit PM approval required before merge

---

## Step 6 — Update Linear after each completed lane

After every completed lane, immediately:
- Mark issue Done
- Attach PR link
- Attach merge commit hash if merged
- Note any blockers if not completed

```bash
pnpm linear:close -- <issue-id> --comment "<test count, verdict, key finding>"
# or
pnpm linear:update -- <issue-id> --state Done
pnpm linear:comment -- <issue-id> --body "<summary>"
```

Do not batch Linear updates. Update immediately after each lane closes.

---

## Step 7 — Repeat or stop

Repeat Steps 1–6 until no executable issues remain.

**Stop conditions — do not continue blindly if:**
- Issue scope is ambiguous
- Linear state conflicts with repo truth and cannot be reconciled
- A task requires a missing contract
- A task overlaps another active lane
- Baseline on main is failing
- An issue depends on unresolved upstream work
- A T1 issue requires PM approval that hasn't been given

When stopping, produce a completion report (see output format).

---

## Output format (completion report)

```
## Linear Sync — <date>

### Completed this session
| ID | Title | PR | Merge commit | Verdict |
|----|-------|----|----|---------|
| UTV2-XXX | ... | #N | abc1234 | MERGED |

### Blocked issues
| ID | Title | Exact blocker |
|----|-------|--------------|
| UTV2-XXX | ... | Missing contract for X |

### Reshaped issues created
- UTV2-XXX: <reason for reshaping>
— or NONE

### Queue state
- Ready: N issues remaining
- In Progress: N (all active, none stale)
- In Review: N (PRs open)

### Next recommended batch
- UTV2-XXX — Claude-only — reason
- UTV2-XXX — Codex-safe — reason
— or: No executable issues remain
```
