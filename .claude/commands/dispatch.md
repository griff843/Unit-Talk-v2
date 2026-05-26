# /dispatch

One-command lane execution. Pulls from the dispatch queue, routes to the right executor, and runs the full lane end-to-end.

## Mandatory merge wrapper

Use `pnpm ops:merge-wrapper` for PR merge, PR branch refresh, and post-merge `main` sync operations. Do not call raw `gh pr merge`, `gh pr update-branch`, `git pull origin main`, `git merge origin/main`, or `git rebase origin/main`; those bypass the merge mutex.

## Lane isolation

Parallel lane execution must use dedicated git worktrees. The main checkout is a control/merge checkout only; do not execute lane implementation by branch-switching the main checkout. `/dispatch` must start each lane through `pnpm ops:lane-start`, and `ops:lane-start` owns worktree creation/resume, branch checkout, manifest creation, file-scope lease reservation, and cwd verification.

Expected layout:

```text
main checkout: /home/griff843/code/Unit-Talk-v2
lane cwd:      /home/griff843/code/Unit-Talk-v2/.out/worktrees/<owner>__utv2-###-slug
```

Each lane worktree must have isolated install/build state. Do not junction, symlink, or otherwise share `node_modules` from the main checkout into a lane worktree.

**Usage:**
- `/dispatch` — auto-pick the top dispatch candidate and execute
- `/dispatch UTV2-###` — execute a specific issue
- `/dispatch UTV2-### UTV2-### UTV2-###` — execute multiple in parallel within `docs/governance/CONCURRENCY_CONFIG.json` executor limits and singleton/forbidden-combination rules
- `/dispatch --dry-run` — show what would be dispatched without executing

**Arguments:** `$ARGUMENTS`

---

## Execution flow

### Phase 0: Live safety gates

Before resolving targets or routing any issue, run the live governor and reconciliation checks. Abort on any hard fail or block; do not proceed to Phase 1.

```bash
pnpm ops:merge-risk
pnpm ops:execution-state
pnpm ops:lane-maximizer
pnpm ops:orchestration-reconcile --current --json
```

Use `ops:execution-state` as the concurrency authority for active lanes by executor, available slots, stale heartbeats, singleton blockers, merge mutex state, proof readiness, and recommended actions.

Use `ops:lane-maximizer` as the dispatch recommendation authority. Executor limits, singleton classes, and forbidden combinations come from `docs/governance/CONCURRENCY_CONFIG.json`; policy rationale lives in `docs/governance/LANE_CONCURRENCY_POLICY.md`. Do not copy numeric executor caps into this command.

If `ops:merge-risk`, `ops:execution-state`, or `ops:lane-maximizer` reports a hard fail, block, no safe slot for the candidate executor, or an unsafe forbidden combination:

```
[dispatch] HALTED — live governor blocked: {top condition}. Resolve the block before dispatching.
```

If reconciliation does not pass, surface exactly one repair command from the first repair-plan action and stop before dispatching:

```
[dispatch] HALTED — reconciliation drift detected.
Repair command: {first repair_plan action command | none available}
```

After the executable gates pass, the operator may ask the lane-governor agent for a concise summary. This is advisory only; the scripts above are the authority.

```typescript
Agent({
  subagent_type: "lane-governor",
  description: "Concurrency preflight before dispatch",
  prompt: "Check current lane state and confirm headroom before dispatch. Report: available Claude slots, available Codex slots, any forbidden combinations active, any file-scope locks that would block the candidate issues. Issues to check (if known): {issue_ids}. Be concise — one paragraph max."
})
```

### Phase 1: Resolve targets

If no issue IDs provided:
1. Run the daily digest dispatch query by executing: `source local.env && export LINEAR_API_TOKEN && npx tsx scripts/ops/daily-digest.ts --json`
2. Parse `dispatch_candidates` from the JSON output
3. If empty: report "No dispatchable issues. Add tier labels to Ready issues in Linear." and stop.
4. Pick candidates from `ops:lane-maximizer` recommendations up to the available executor slots reported by `ops:execution-state`; dangerous classes (Runtime, Migration, Modeling, Data/Canonical) remain singleton per config and policy.

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

### Phase 3: Start lanes

For each validated target:

1. Determine branch name: `claude/utv2-{number}-{slug}` or `codex/utv2-{number}-{slug}`
2. Determine file scope from the issue description (look for explicit file paths first; fall back to package names or area labels). Declare the **narrowest possible scope** — list individual files when known (`apps/worker/src/processor.ts`), not directory globs (`apps/worker/**`), unless the issue explicitly requires changes across the full subtree. Overly broad locks block other lanes unnecessarily.
3. Start the lane through the kernel. Do not hand-roll worktree eligibility, branch creation, manifest creation, or file-scope locking in prose. Do not check out the lane branch on the main checkout.

   ```bash
   pnpm ops:merge-wrapper main-sync --issue UTV2-{number} --branch main
   pnpm ops:lane-start UTV2-{number} --tier {T1|T2|T3} --branch {branch} --lane-type {lane_type} --executor {claude|codex-cli|codex-cloud} --files {file_scope_lock[0]} --files {file_scope_lock[1]}
   ```
   `ops:lane-start` owns branch/worktree creation, lease reservation, cwd coherence, and isolated install verification. Treat the `cwd`/`worktree_path` it reports as the only valid execution directory for that lane.
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
   `lane_start_cwd` must be the dedicated lane worktree path reported by `ops:lane-start`, not the main checkout.

### Phase 4: Execute

**Claude lanes** (T1, T3, T2 with migration/contract, or T2 when Codex unavailable):
- Execute the work directly in this conversation from the dedicated lane worktree reported by `ops:lane-start`
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
- Execute via the canonical Codex entry point — never call `codex exec` or `codex run` directly:
  ```bash
  npx tsx scripts/ops/codex-exec.ts --issue UTV2-{number}
  ```
  This script reads the lane manifest, embeds `agent-brief.md`, validates CWD, and runs Codex with standardized args. `--dry-run` flag previews the prompt without executing.
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
- **Executor limits are config-backed.** Use `docs/governance/CONCURRENCY_CONFIG.json` through `ops:execution-state` and `ops:lane-maximizer`; do not self-authorize lane expansion or duplicate numeric caps in prose.
- **Singleton and forbidden-combination rules are config-backed.** Runtime, migration, modeling, and data/canonical lanes remain singleton per the live governor model.
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
  "execution_location": {
    "mode": "worktree",
    "cwd": ".out/worktrees/claude__utv2-###-slug",
    "package_install": "verified",
    "setup_command": "pnpm install --frozen-lockfile",
    "main_checkout_control_only": false
  },
  "worktree_path": ".out/worktrees/claude__utv2-###-slug",
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
