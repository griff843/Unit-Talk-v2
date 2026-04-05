# Lane Manager — Workflow Subsystem

**Authority tier:** Operational tooling (T3 — no proof required, maintained continuously)
**Purpose:** Repo-native workflow hardening for solo operator continuity, parallel lane management, and session drift detection.

---

## Why it exists

Unit Talk V2 uses parallel Codex and Claude execution lanes across multiple sessions. Without explicit lane tracking, three problems accumulate:

1. **Session continuity loss** — resuming a mid-lane session requires manual reconstruction of state from Linear + git + status docs (5–15 min per resume)
2. **Worktree entropy** — git worktrees used for parallel isolation pile up with no record of which issue they belong to
3. **Drift blindness** — Linear state, branch state, and status docs diverge silently across sessions

The lane manager solves all three with a lightweight local state model and five CLI commands.

---

## State Model

### Ephemeral local state (gitignored)

| Path | Purpose |
|---|---|
| `.claude/lanes.json` | Live lane registry — maps issue IDs to branches, worktrees, status, and snapshot timestamps |
| `.claude/snapshots/<ID>.json` | Per-lane continuation snapshot — captures objective, completed work, files touched, decisions, next action |
| `.claude/worktrees/<ID>/` | Git worktrees for isolated lane execution (already gitignored) |

**These files are never committed.** They are session-local operator state. Linear + git branches remain the durable source of truth.

### Durable repo truth (committed)

- Linear issues — authoritative queue and issue state
- Git branches and PRs — branch existence and merge status
- `docs/06_status/PROGRAM_STATUS.md` — milestone and runtime status

### What the lane manager does NOT replace

- Linear issue tracking (still authoritative)
- The proof gate system (`/t1-proof`, `pnpm verify`)
- `pnpm ops:brief` (still the runtime snapshot command)
- `PROGRAM_STATUS.md` (still the canonical status doc)

---

## Command Reference

### `pnpm lane:spawn`

Creates a lane entry with a new git branch and optionally a git worktree.

```bash
pnpm lane:spawn -- --issue UTV2-XXX
pnpm lane:spawn -- --issue UTV2-XXX --title "SGO scoring fix" --owner codex --worktree
pnpm lane:spawn -- --issue UTV2-XXX --base feat/some-other-base
```

**Options:**
- `--issue <ID>` — Linear issue ID (required, or inferred from current branch)
- `--title <text>` — Human label for the lane (used in branch slug)
- `--owner claude|codex|manual` — Lane owner (default: claude)
- `--worktree` — Create an isolated git worktree at `.claude/worktrees/<ID>/`
- `--base <ref>` — Base branch/commit (default: main)

**Safety checks:**
- Blocks if an active lane for the same issue already exists
- Blocks Codex spawn if Codex capacity is at 2/2
- Blocks if branch already exists
- Blocks if worktree directory already exists

**Branch naming:** `feat/<issue-id-lowercase>-<title-slug>` or `feat/<issue-id-lowercase>` if no title.

---

### `pnpm lane:list`

Shows all lanes with ID, branch, owner, status, age, and snapshot freshness.

```bash
pnpm lane:list
```

Warns if any active lanes have no snapshot or a snapshot older than 2 days.

---

### `pnpm lane:snapshot`

Captures a structured continuation packet for a lane.

```bash
pnpm lane:snapshot -- --issue UTV2-XXX --next "run pnpm verify:pick -- <id>"
pnpm lane:snapshot -- --issue UTV2-XXX \
  --obj "Fix SGO grading to use odds.score" \
  --next "run pnpm type-check, then open PR" \
  --decisions "use odds.score not results.game,rookie has no pinnacle data" \
  --blockers "waiting on SGO Pro trial confirmation" \
  --drift "do not touch settlement_records schema"
```

**Options:**
- `--issue <ID>` — Issue ID (required, or inferred from branch)
- `--obj <text>` — Objective / what this lane is for
- `--next <text>` — Exact next action (most important field)
- `--progress <text>` — What's currently in progress
- `--completed <csv>` — Comma-separated list of completed items
- `--decisions <csv>` — Comma-separated list of decisions made
- `--blockers <csv>` — Comma-separated list of current blockers
- `--drift <csv>` — Comma-separated must-not-drift rules

**Files touched** are auto-captured from `git diff --name-only` vs main.

Output written to `.claude/snapshots/<ID>.json`.

---

### `pnpm lane:resume`

Prints a structured resume packet for a lane. Designed to be the first output read when restarting a session on an in-progress lane.

```bash
pnpm lane:resume -- --issue UTV2-XXX
```

Shows: objective, completed steps, files touched, decisions made, blockers, must-not-drift rules, and the exact next action.

Also shows branch/worktree switch advisory if not already on the correct branch.

---

### `pnpm lane:cleanup`

Identifies and removes lanes whose branches have been merged to main or that are abandoned.

```bash
pnpm lane:cleanup -- --dry-run   # preview only
pnpm lane:cleanup                # apply safe removals (merged + abandoned)
pnpm lane:cleanup -- --force UTV2-XXX  # force-close a specific lane
```

**Safe auto-remove conditions:**
- Branch is merged to main (`git branch --merged main`)
- Lane status is `abandoned`

**Review-only conditions (requires `--force`):**
- Lane is 14+ days old and never snapshotted
- Lane is 21+ days old

Also reports orphaned worktree directories (in `.claude/worktrees/` but not in registry).

---

### `pnpm ops:health`

Fast workflow drift check. Run at session start before `ops:brief`.

```bash
pnpm ops:health
pnpm ops:health -- --json
```

**Checks (all local/git, no network):**
1. Lane registry — stale snapshots, merged-but-still-active, Codex capacity
2. Worktrees — orphaned dirs, git worktree list consistency
3. Branches — feat/* branches older than 3d not in registry
4. Status docs — PROGRAM_STATUS.md age vs last commit

**Severity levels:**
- `[BLOCKER]` — must resolve before starting new work
- `[WARN]` — review when convenient, safe to work
- `[OK]` — healthy
- `[INFO]` — informational, no action needed

**Exit codes:** 0 = HEALTHY/DEGRADED, 1 = BLOCKED

---

## Workflow Integration

### Session start (update to system-state-loader)

```bash
pnpm ops:health              # drift check first
pnpm lane:list               # see active lanes
pnpm lane:resume -- --issue UTV2-XXX  # if resuming a specific lane
pnpm ops:brief               # full runtime snapshot
```

### Starting a new lane

```bash
pnpm lane:spawn -- --issue UTV2-XXX --title "descriptive title"
git checkout feat/utv2-xxx-descriptive-title
# ... do the work ...
pnpm lane:snapshot -- --issue UTV2-XXX --next "exact next step"
```

### Closing a session mid-lane

```bash
pnpm lane:snapshot -- --issue UTV2-XXX --next "exact next step" --decisions "..." 
# session-summary.sh hook will remind you if you forget
```

### Resuming after a break

```bash
pnpm lane:resume -- --issue UTV2-XXX
# output is the complete resume packet
```

### Closing a lane after merge

```bash
pnpm lane:cleanup -- --dry-run   # verify what will be removed
pnpm lane:cleanup                # apply
```

---

## Safety Model

- **Read-only by default:** `lane:list`, `lane:resume`, `ops:health` never mutate state.
- **Dry-run available:** `lane:cleanup -- --dry-run` always safe to run.
- **No force on active data:** `lane:cleanup` only auto-removes merged or abandoned lanes. Active lanes with unmerged branches require `--force`.
- **Auto-register:** `lane:snapshot` auto-registers a lane if it's missing from the registry (for branches predating the lane manager).
- **No network required:** All commands work offline. Linear API integration is not required.
- **No git destructive ops:** Cleanup runs `git worktree remove` (safe — only removes the checkout, not the branch) and `git worktree prune` (prunes stale refs). It does not delete branches.

---

## Limitations

- **No Linear sync:** The lane registry does not automatically sync with Linear. PR numbers and issue status must be updated manually or via `pnpm linear:update`.
- **No cross-machine sync:** `.claude/lanes.json` is local-only. If you work across machines, you'll need to rebuild the registry with `lane:spawn` or `lane:snapshot`.
- **Turn-count context estimation:** The `/context-checkpoint` skill uses heuristic turn-count estimation — not a real token counter. Treat its threshold recommendations as advisory.
- **Windows path separators:** Worktree paths are stored with forward slashes for git compatibility. `path.join()` is used internally for fs operations.
