# /dispatch

One-command lane execution. Pulls from the dispatch queue, routes to the right executor, and runs the full lane end-to-end.

**Usage:**
- `/dispatch` — auto-pick the top dispatch candidate and execute
- `/dispatch UTV2-###` — execute a specific issue
- `/dispatch UTV2-### UTV2-### UTV2-###` — execute multiple in parallel (1 Claude + up to 2 Codex)
- `/dispatch --dry-run` — show what would be dispatched without executing

**Arguments:** `$ARGUMENTS`

---

## Execution flow

### Phase 1: Resolve targets

If no issue IDs provided:
1. Run the daily digest dispatch query by executing: `source local.env && export LINEAR_API_TOKEN && npx tsx scripts/ops/daily-digest.ts --json`
2. Parse `dispatch_candidates` from the JSON output
3. If empty: report "No dispatchable issues. Add tier labels to Ready issues in Linear." and stop.
4. Pick candidates up to capacity: 1 Claude lane + up to 2 Codex lanes

If issue IDs provided:
1. For each issue ID, query Linear via MCP (`mcp__claude_ai_Linear__get_issue`) to get labels, state, description
2. Determine tier from labels (tier:T1, tier:T2, tier:T3)
3. Apply routing defaults: T1→Claude, T2 clear-scope→Codex, T2 with migration/contract→Claude, T3→Claude

### Phase 2: Validate prerequisites (for each target)

Check each target has:
- [ ] Tier label set (tier:T1, tier:T2, or tier:T3)
- [ ] State is "unstarted" type (Ready for Claude, Ready for Codex, Ready, etc.)
- [ ] Description contains acceptance criteria (search for "Acceptance criteria" or "AC:" or "What to do")

If any check fails, report which prerequisite is missing and skip that issue.

For `--dry-run`: stop here and report the dispatch plan as a table:
```
| Issue | Title | Tier | Executor | Prerequisites |
```

### Phase 2.5: Codex health check (before routing to Codex)

Before routing any lane to Codex, run:
```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If `healthy: false`:
- **Do not dispatch to Codex.** Route the lane to Claude instead.
- Report: "Codex unavailable ({error}), falling back to Claude for {issue_id}"
- This prevents silent failures and fake slot occupancy (UTV2-681).

### Phase 3: Start lanes

For each validated target:

1. Determine branch name: `claude/utv2-{number}-{slug}` or `codex/utv2-{number}-{slug}`
2. Determine file scope from the issue description (look for file paths, package names, or area labels)
3. Create the lane manifest:
   ```bash
   git checkout main && git pull --ff-only origin main
   git checkout -b {branch}
   ```
   For Codex lanes that need a separate worktree, create it inside the main repo (`.worktrees/` is gitignored, keeping all writes inside the Codex sandbox boundary):
   ```bash
   git worktree add .worktrees/utv2-{number}-fix {branch}
   pwsh scripts/ops/worktree-setup.ps1 .worktrees/utv2-{number}-fix
   ```
   This script junctions root + per-app node_modules from the main repo and copies `local.env`
   so `pnpm verify` works without a full `pnpm install`.
4. Update Linear issue state to "In Claude" or "In Codex" via MCP
5. Create the lane manifest and commit it to the branch:
   ```bash
   # Write docs/06_status/lanes/UTV2-{number}.json (from template below)
   git add docs/06_status/lanes/UTV2-{number}.json
   git commit -m "chore(lanes): add UTV2-{number} lane manifest"
   ```

### Phase 4: Execute

**Claude lanes** (T1, T3, T2 with migration/contract, or T2 when Codex unavailable):
- Execute the work directly in this conversation
- Follow the acceptance criteria from the issue description
- Run `pnpm verify` after implementation
- Open PR via `gh pr create`
- After `gh pr create` returns a PR URL/number, immediately apply the tier label:
  ```bash
  gh pr edit <PR-number-or-URL> --add-label "tier:T1"   # replace with actual tier: T1 / T2 / T3
  ```
  Never leave a PR open without a tier label — tier-label-check CI will block the merge gate.
- Post executor-result comment on the PR

**Codex lanes** (T2 clear-scope, only when Codex health check passes):
- Dispatch via Codex rescue agent with the issue description as the prompt
- Include: issue ID, acceptance criteria, file scope, branch name
- After Codex opens the PR, immediately apply the tier label:
  ```bash
  gh pr edit <PR-number-or-URL> --add-label "tier:T2"   # replace with actual tier: T1 / T2 / T3
  ```
  Never leave a PR open without a tier label — tier-label-check CI will block the merge gate.
- Report that Codex lane is dispatched and will need review on return

### Phase 5: Sequential execution for multiple lanes

When dispatching multiple lanes:
1. Start Claude lane first (execute directly)
2. Dispatch Codex lanes in background (they run in parallel)
3. After Claude lane PR is open, check Codex status
4. Review Codex results when they return

### Merge order declaration

When dispatching multiple lanes, emit a merge-order table before starting:

| Lane | Issue | Files touched | Must merge after |
|------|-------|--------------|-----------------|
| Claude | UTV2-NNN | apps/api/src/foo.ts | (none — base) |
| Codex  | UTV2-MMM | apps/command-center/** | UTV2-NNN (imports its output) |

Rules:
- A lane must appear in "Must merge after" if it imports or calls output from another open lane.
- Lanes touching fully disjoint areas have no dependency — write "none" explicitly.
- Each agent's PR body must include a `## Merge order` section citing this table.

### Phase 5.5: Fibery auto-sync (for proof lanes)

After a proof lane merges, automatically sync proof artifacts to Fibery:
```bash
source local.env && export FIBERY_API_URL FIBERY_API_TOKEN && npx tsx scripts/ops/fibery-proof-sync.ts UTV2-###
```

This replaces the manual Fibery update cycle (create artifacts → link → update status).
If Fibery credentials are not set, skip with a note.

### Phase 6: Report

After all dispatches:
```
DISPATCH COMPLETE
━━━━━━━━━━━━━━━━
Claude: UTV2-651 [T3] → PR #372 opened
Codex:  UTV2-609 [T2] → dispatched, in progress
Codex:  UTV2-612 [T2] → dispatched, in progress

Next: merge T3 PR (auto-close fires), then review Codex returns
```

---

## Rules

- **Never dispatch T1 without PM confirmation.** T1 changes require plan approval before execution.
- **Max 1 Claude lane at a time.** Claude executes sequentially.
- **Max 2 Codex lanes in parallel.** Per executor routing defaults.
- **Never start a lane if file scope overlaps with an active lane.** Check manifests first.
- **Fail closed.** If any prerequisite is unclear, skip the issue and report why.
- **Commit message must include issue ID.** Format: `feat|fix|chore(scope): UTV2-### description`
- **PR must include close marker.** Body or title must contain `Closes UTV2-###` for auto-close chain.

---

## Lane manifest template

```json
{
  "schema_version": 1,
  "issue_id": "UTV2-###",
  "lane_type": "claude",
  "tier": "T3",
  "worktree_path": ".",
  "branch": "claude/utv2-###-slug",
  "base_branch": "main",
  "commit_sha": null,
  "pr_url": null,
  "files_changed": [],
  "file_scope_lock": [],
  "expected_proof_paths": [],
  "status": "started",
  "started_at": "ISO-8601",
  "heartbeat_at": "ISO-8601",
  "closed_at": null,
  "blocked_by": [],
  "preflight_token": "dispatch-auto",
  "created_by": "claude",
  "truth_check_history": [],
  "reopen_history": []
}
```
