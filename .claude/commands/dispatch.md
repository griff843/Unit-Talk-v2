# /dispatch

One-command lane execution. Pulls from the dispatch queue, routes to the right executor, and runs the full lane end-to-end.

## Mandatory merge wrapper

Use `pnpm ops:merge-wrapper` for PR merge, PR branch refresh, and post-merge `main` sync operations. Do not call raw `gh pr merge`, `gh pr update-branch`, `git pull origin main`, `git merge origin/main`, or `git rebase origin/main`; those bypass the merge mutex.

**Usage:**
- `/dispatch` — auto-pick the top dispatch candidate and execute
- `/dispatch UTV2-###` — execute a specific issue
- `/dispatch UTV2-### UTV2-### UTV2-###` — execute multiple in parallel (up to 2 Claude + up to 3 Codex for safe classes)
- `/dispatch --dry-run` — show what would be dispatched without executing

**Arguments:** `$ARGUMENTS`

---

## Execution flow

### Phase 1: Resolve targets

If no issue IDs provided:
1. Run the daily digest dispatch query by executing: `source local.env && export LINEAR_API_TOKEN && npx tsx scripts/ops/daily-digest.ts --json`
2. Parse `dispatch_candidates` from the JSON output
3. If empty: report "No dispatchable issues. Add tier labels to Ready issues in Linear." and stop.
4. Pick candidates up to capacity: up to 2 Claude lanes + up to 3 Codex lanes for safe work classes (Governance, Hygiene, Verification, Delivery/UI); dangerous classes (Runtime, Migration, Modeling, Data/Canonical) remain singleton per type — see `docs/governance/LANE_CONCURRENCY_POLICY.md §10`

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
3. Start the lane through the kernel. Do not hand-roll worktree eligibility, branch creation, manifest creation, or file-scope locking in prose.

   ```bash
   pnpm ops:merge-wrapper main-sync --issue UTV2-{number} --branch main
   pnpm ops:lane-start UTV2-{number} --tier {T1|T2|T3} --branch {branch} --lane-type {lane_type} --executor {claude|codex-cli|codex-cloud} --files {file_scope_lock[0]} --files {file_scope_lock[1]}
   ```
   `ops:lane-start` owns branch/worktree creation, lease reservation, cwd coherence, and isolated install verification.
4. Update Linear issue state to "In Claude" or "In Codex" via MCP
5. Confirm `ops:lane-start` created the lane manifest and per-issue sync file, then commit both to the branch:
   ```bash
   git add docs/06_status/lanes/UTV2-{number}.json ".ops/sync/UTV2-{number}.yml"
   git commit -m "chore(lanes): UTV2-{number} lane manifest and sync metadata"
   ```

   **Per-issue sync file schema** (`.ops/sync/UTV2-{number}.yml`):
   ```yaml
   version: 1
   approval:
     allow_multiple_issues: false
     skip_sync_required: false
   entities:
     issues:
       - UTV2-{number}          # only this lane's issue — no other IDs
     findings: []
     controls: []
     proofs: []                 # populate from manifest.expected_proof_paths if non-empty
   ```
   If `expected_proof_paths` is non-empty in the manifest, each path becomes an entry under `entities.proofs`.

   **Per-issue sync rule:** Each lane writes its own `.ops/sync/UTV2-{number}.yml`. Never mutate the shared `.ops/sync.yml` — that file stays neutral on main (`issues: []`). The `branch-discipline-guard` CI check reads the per-issue file automatically from the PR branch name.

6. For long-running work, refresh the lease heartbeat before it expires:
   ```bash
   pnpm ops:lease heartbeat --issue UTV2-{number} --branch {branch} --executor {claude|codex-cli|codex-cloud} --cwd {lane_start_cwd}
   ```

### Phase 4: Execute

**Claude lanes** (T1, T3, T2 with migration/contract, or T2 when Codex unavailable):
- Execute the work directly in this conversation
- Follow the acceptance criteria from the issue description
- Run `pnpm verify` after implementation

**Before opening PR — required for all lanes:**

**Batch A — run these two in parallel (single message, two Bash tool calls):**
- `pnpm verify` — full pipeline (env:check + lint + type-check + build + test) — must exit 0
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — note triggered rules

If `pnpm verify` fails, fix and re-run. If R-level flags missing artifacts, generate them in **Batch B**:

**Batch B — run in parallel only if needed (artifacts flagged by R-level):**
- `r2-determinism`: `tsx scripts/live-data-lab-runner.ts` (skip if file not found)
- `r3-shadow-report`: `tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json` (skip if file not found)
- `qa-experience-report`: `pnpm qa:experience --regression --mode fast` (skip if file not found)

**Batch C — final confirmation:**
Re-run `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — must PASS.
Paste the PASS output into PR body under `## R-level compliance`.

**If lane tier is T1:**
- Also run: `pnpm test:db`
- Paste the last 30 lines of output into PR body under `## Live-DB proof`
- A T1 PR must not be opened without pnpm test:db PASS

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
- Codex must complete the following before opening the PR:

**Before opening PR — required for all lanes:**

**Batch A — run these two in parallel (single message, two Bash tool calls):**
- `pnpm verify` — full pipeline (env:check + lint + type-check + build + test) — must exit 0
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — note triggered rules

If `pnpm verify` fails, fix and re-run. If R-level flags missing artifacts, generate them in **Batch B**:

**Batch B — run in parallel only if needed (artifacts flagged by R-level):**
- `r2-determinism`: `tsx scripts/live-data-lab-runner.ts` (skip if file not found)
- `r3-shadow-report`: `tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json` (skip if file not found)
- `qa-experience-report`: `pnpm qa:experience --regression --mode fast` (skip if file not found)

**Batch C — final confirmation:**
Re-run `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — must PASS.
Paste the PASS output into PR body under `## R-level compliance`.

- After Codex opens the PR, immediately apply the tier label:
  ```bash
  gh pr edit <PR-number-or-URL> --add-label "tier:T2"   # replace with actual tier: T1 / T2 / T3
  ```
  Never leave a PR open without a tier label — tier-label-check CI will block the merge gate.
- Report that Codex lane is dispatched and will need review on return

### Phase 5: Sequential execution for multiple lanes

When dispatching multiple lanes:
1. Start Claude lane first (execute directly)
2. Dispatch Codex lanes in background (they run in parallel) via `Agent({run_in_background: true})`
3. After Claude lane PR is open, continue other work — you will be **automatically notified** when background Codex lanes complete
4. On Codex completion notification: review diff, run critique, apply tier label, then use `PushNotification` to surface the result if the session needs a summary
5. If abandoning an active lane before work begins, release the lease explicitly:
   ```bash
   pnpm ops:lease release --issue UTV2-{number} --actor claude --reason "abandoned before implementation"
   ```

**Monitoring long-running shell commands:**
When running `pnpm build`, `pnpm test`, or other slow Bash commands in background, use the `Monitor` tool to stream stdout in real time rather than waiting blind:
```typescript
// Launch long build in background
Bash({ command: "pnpm build", run_in_background: true })
// Then stream its output
Monitor({ /* process reference */ })
```
Do not poll with sleep loops — Monitor receives each stdout line as a notification.

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
- **Default: max 2 Claude lanes (safe work classes).** Dangerous classes (Runtime, Migration, Modeling, Data/Canonical) are singleton per type regardless. See `docs/governance/LANE_CONCURRENCY_POLICY.md §10`.
- **Default: max 3 Codex lanes (safe work classes).** Same dangerous-class restrictions apply. Total hard cap is 5 active lanes across all executors.
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
  "lane_type": "governance",
  "executor": "claude",
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

**Lane type selection guide** (choose the correct `lane_type`):
| lane_type      | Use for                                                              |
|----------------|----------------------------------------------------------------------|
| runtime        | Worker, outbox, delivery, API logic, dead-letter, scoring adapters  |
| modeling       | CanonicalPick schema, scoring logic, CLV, promotion rules           |
| verification   | Proof bundles, evidence, test scaffolding, truth-check tooling      |
| hygiene        | Lint, cleanup, debt reduction, formatting, dead code removal        |
| migration      | DB migrations, schema.generated.ts, database.types.ts              |
| governance     | Lane contracts, CI workflows, dispatch skill, audit docs, policies  |
| delivery-ui    | Discord bot, command-center, smart-form, QA agent                  |
| data-canonical | Ingestor, odds data, provider canonical transforms                  |

**Executor** is separate from `lane_type`:
- `"executor": "claude"` — Claude Code executed the lane
- `"executor": "codex-cli"` — Codex executed the lane
```
