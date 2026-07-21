# /dispatch

One-command lane execution. Pulls from the dispatch queue, routes to the right executor, and runs the full lane end-to-end.

## Mandatory merge wrapper

Use `pnpm ops:merge-wrapper` for PR merge, PR branch refresh, and post-merge `main` sync operations. Do not call raw `gh pr merge`, `gh pr update-branch`, `git pull origin main`, `git merge origin/main`, or `git rebase origin/main`; those bypass the merge mutex.

## Lane isolation

Parallel lane execution must use dedicated git worktrees. The main checkout is a control/merge checkout only; do not execute lane implementation by branch-switching the main checkout. `/dispatch` must start each lane through `pnpm ops:lane-start`, and `ops:lane-start` owns worktree creation/resume, branch checkout, manifest creation, file-scope lease reservation, and cwd verification.

**Exception — T3 docs-only fast path:** if and only if the issue is T3 and every candidate file is a docs/status path (`docs/06_status/**` or `.claude/commands/*.md`), dispatch may skip worktree isolation, manifest/lease/sync creation, and truth-check closeout. This is a fail-closed exception, not an executor judgment call: run `pnpm ops:preflight <issue> --tier T3 --branch <branch> --docs-only-fast-path --files <path1> [--files <path2> ...]`, then `pnpm ops:lane-start <issue> --tier T3 --branch <branch> --docs-only-fast-path --files <path1> [--files <path2> ...]` as the mechanical no-op validator. `--files` must be repeated once per path — the parser only consumes the next token as each flag's value, so space-separated paths after a single `--files` are silently dropped as ignored positionals, not treated as additional files. Any non-docs path disqualifies the fast path and the normal lane system applies.

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
pnpm ops:substrate-guard
pnpm ops:merge-risk
pnpm ops:execution-state
pnpm ops:lane-maximizer
pnpm ops:orchestration-reconcile --current --json
```

`ops:substrate-guard` runs FIRST and is fail-closed: it refuses dispatch when the lane-execution substrate is unsafe — `.ops/leases/` missing and uninitializable, `.ops/merge-lock.json` present-but-invalid, an active lane whose worktree directory is missing, a board `hard_fail` lane (folds in `ops:merge-risk`), or (with `--check-linear`) a Linear/manifest conflict. It tolerates transient WSL ENOENT by retry-probing before declaring substrate genuinely absent. Exit code 1 ⇒ HALT. The same guard runs again mechanically inside `ops:lane-start` (local checks) so no lane can reserve a lease or create a worktree on unsafe substrate even if Phase 0 was skipped; break-glass is `--force-unsafe-substrate`.

Use `ops:execution-state` as the concurrency authority for active lanes by executor, available slots, stale heartbeats, singleton blockers, merge mutex state, proof readiness, and recommended actions.

Use `ops:lane-maximizer` as the dispatch recommendation authority. Executor limits, singleton classes, and forbidden combinations come from `docs/governance/CONCURRENCY_CONFIG.json`; policy rationale lives in `docs/governance/LANE_CONCURRENCY_POLICY.md`. Do not copy numeric executor caps into this command.

If `ops:substrate-guard`, `ops:merge-risk`, `ops:execution-state`, or `ops:lane-maximizer` reports a hard fail, block, no safe slot for the candidate executor, or an unsafe forbidden combination:

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

### Phase 0.5: Live Linear context pull

Before resolving targets, pull fresh Linear state for each candidate issue. Do not route from memory or stale manifests.

For each candidate issue ID:
```
mcp__claude_ai_Linear__get_issue({"id": "<issue_id>"})
```

From the response, extract and record: current state, tier label, priority, blocking issue IDs, and assignee. Exclude any issue whose current state is Done, Cancelled, or Blocked — do not process further. This ensures routing decisions reflect Linear truth, not cache.

### Phase 1: Resolve targets

**Mandatory three-brain routing:** Call `/three-brain` for every candidate before assigning an executor. Do not assign from memory or prior session routing. Three-brain owns the routing decision; this skill owns the lane lifecycle. If `/three-brain` is not called for a candidate, do not dispatch that candidate.

If no issue IDs provided:
1. Run the daily digest dispatch query by executing: `source local.env && export LINEAR_API_TOKEN && npx tsx scripts/ops/daily-digest.ts --json`
2. Parse `dispatch_candidates` from the JSON output
3. If empty: report "No dispatchable issues. Add tier labels to Ready issues in Linear." and stop.
4. Pick candidates from `ops:lane-maximizer` recommendations up to the available executor slots reported by `ops:execution-state`; dangerous classes (Runtime, Migration, Modeling, Data/Canonical) remain singleton per config and policy.

If issue IDs provided:
1. For each issue ID, query Linear via MCP (`mcp__claude_ai_Linear__get_issue`) to get labels, state, description
2. Determine tier from labels (tier:T1, tier:T2, tier:T3)
3. Call `/three-brain` for each candidate — the routing decision returned by `/three-brain` is authoritative. Apply routing defaults only if `/three-brain` is unavailable: T1→Claude, T2 clear-scope→Codex, T2 with migration/contract→Claude, T3→Claude

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
   **Codex executors only:** append `--model-profile {profile}` using the profile three-brain resolved (`/three-brain`'s Codex model-profile routing table). `ops:lane-start` rejects a Codex lane started without `--model-profile`, and rejects `--model-profile` on a `claude` executor. See `/three-brain` and `docs/05_operations/policies/codex-model-routing.json`.

   `ops:lane-start` owns branch/worktree creation, lease reservation, cwd coherence, and isolated install verification. Treat the `cwd`/`worktree_path` it reports as the only valid execution directory for that lane.
   For the T3 docs-only fast path only, replace lane creation with:
   ```bash
   pnpm ops:lane-start UTV2-{number} --tier T3 --branch {branch} --docs-only-fast-path --files {file_scope[0]} --files {file_scope[1]}
   ```
   A successful `code: "docs_only_fast_path"` response means lane-start intentionally created no worktree, manifest, lease, sync file, or proof scaffold. Continue on a normal PR branch and rely on CI, branch discipline, lane authority, merge gate, tier label, and Linear auto-close.
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

**T1 lanes — mandatory planning phase before execution:**

Spawn a planning subagent before touching any code. **Resolve the planning model — never hardcode a literal.** Call `resolvePlanningModel()` (`scripts/ops/planning-model-routing.ts`) with the lane's tier and, if `/three-brain` identified one of the four ratified Fable pilot trigger classes for this issue (`.claude/commands/three-brain.md`'s "Fable 5 pilot routing" section), pass that trigger class and a rationale. Use `toAgentModelOverride(resolution.routing.model)` as the Agent call's `model` value — `"sonnet"` for the ordinary case and every fallback path (pilot ineligible, policy disabled, unknown/skip-listed trigger class), `"fable"` only when the pilot is genuinely active, within its caps, and the trigger class matches. There is no manual escalation tier above what this resolver returns: genuinely novel architecture, constitutional scope, or unresolved scope ambiguity outside the four ratified classes is still a Rule 9 Griff-escalation trigger, not a model-routing decision. Full policy: `docs/05_operations/OPERATING_MODEL_SONNET5.md`.

The plan this subagent produces is an **Outcome Contract** — a planning artifact only. It does not replace the lane manifest, `file_scope_lock`, `expected_proof_paths`, R-level checks, or PM merge gates. Its "Scope" and proof-relevant sections must generate-or-match the lane manifest's `file_scope_lock`/`expected_proof_paths` at lane-start time. Any divergence discovered later (e.g. the PR touches files outside the declared scope) is itself a Rule 9 escalation trigger — do not silently patch the manifest and continue.

```typescript
const routing = resolvePlanningModel({
  tier: "T1",
  triggerClass: fable_trigger_class, // set by /three-brain routing, or null/undefined for the ordinary case
  rationale: fable_rationale ?? "standard T1 planning",
});
// routing.routing.model is "claude-sonnet-5" or "claude-fable-5"; routing.routing.fallback_used
// is true whenever a requested Fable trigger class fell back to Sonnet -- report this in
// Phase 6, never drop it silently.

Agent({
  model: toAgentModelOverride(routing.routing.model), // "sonnet" | "fable"
  description: `T1 planning: ${issue_id}`,
  prompt: `You are planning a T1 lane before implementation begins. Do not write code.

Issue: ${issue_id}
Title: ${issue_title}
Description: ${issue_description}
Acceptance criteria: ${acceptance_criteria}

Read these files for context (use Read/Grep — do not edit anything):
- docs/CODEBASE_GUIDE.md (architecture reference)
- The specific files named in the issue description
- Any domain invariant files touched by this change

Return an Outcome Contract with these sections:
## Issue
## Objective
## Why this matters
## Success criteria
## Forbidden actions
## Likely touched areas
Exact files to create or modify (absolute paths). Flag any Tier C sensitive paths. This section seeds file_scope_lock.
## PM gates required
Check against the full three-brain.md Rule 9 list — do not narrow it. State explicitly which triggers fire, or "none" if genuinely none apply.
## Required proof
This section seeds expected_proof_paths.
## Runtime validation
Required if runtime/product behavior is affected; state explicitly if N/A for this lane.
## Stop conditions
## Recommended executor
## Invariants at risk
Which of the 11 core invariants (CLAUDE.md) this change touches, and how.

Do not ask PM to choose implementation details unless: multiple valid architecture paths exist, the change involves a DB mutation/migration, public/member-facing delivery, settlement/CLV truth risk, governance-brake release, or Tier C implications. For anything else, decide and note the decision in "Implementation approach" below.

## Implementation approach
Step-by-step sequence. Smallest safe diff first.

## Risk flags
Anything that warrants Griff review beyond the standard T1 gate.`
})
```

Block on the planning result.

**Deliver the plan to Linear for async PM review (mandatory for all T1):**
After the planning subagent returns, immediately post the Outcome Contract as a Linear comment so Griff can review asynchronously without being in the same session:
```
mcp__claude_ai_Linear__save_comment({
  issueId: "<issue_id>",
  body: `## T1 Outcome Contract — awaiting PM approval\n\n<paste full Outcome Contract here>\n\n---\nPlanning model: ${routing.routing.model}${routing.routing.fallback_used ? ` (fallback from ${routing.routing.requested_model}: ${routing.routing.fallback_reason})` : ''}\nStatus: awaiting Griff review before implementation begins.`
})
```
Do not begin implementation until Griff approves — either in-session or via a Linear reply/label change.

**Execution — background subagent, orchestrator stays control-plane:**

Every Claude lane (T1 after plan approval, T2, T3) implements via a background `Agent` call in the worktree `ops:lane-start` already created — the same pattern already used for Codex. The orchestrator session never edits lane implementation files, never runs `pnpm verify`/tests for the lane, and never pushes lane commits directly; it dispatches, waits for the completion notification, then reviews/merges/closes exactly like a returned Codex PR (Phase 5).

```typescript
// Implementation always uses Sonnet, never the resolved planning model above -- "routine
// coding" is explicitly skip-listed in fable-pilot-policy.json even while the pilot is
// active. The Fable pilot only ever applies to the planning pass (Phase 4, above) and the
// advisory review pass (Phase 5, below) -- never to writing the code itself.
Agent({
  run_in_background: true,
  model: "sonnet",
  description: `Claude lane: ${issue_id}`,
  prompt: `Implement ${issue_id} in the pre-created lane worktree at ${worktree_path}. This worktree already exists — cd into that exact path and work there; do not create a new worktree or touch the main checkout.

Issue: ${issue_id}
Title: ${issue_title}
Acceptance criteria: ${acceptance_criteria}
File scope (do not touch anything outside this — declared at lane-start, immutable): ${file_scope_lock}
${tier === 'T1' ? 'Approved Outcome Contract:\n' + outcome_contract : 'Tier: ' + tier + ' — no planning phase required.'}

Do, in order:
1. Implement the change within the declared file scope only.
2. Run \`pnpm verify\` — must exit 0. Fix and re-run if it fails.
3. Run \`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD\`; generate any artifacts it flags as missing.
${tier === 'T1' ? "4. Run `pnpm test:db` and include the last 30 lines of output in the PR body under \"## Live-DB proof\" — a T1 PR must not open without this.\n" : ''}5. Commit with message format \`fix|feat|chore(scope): ${issue_id} description\`.
6. Push the branch and open the PR via \`gh pr create\`. Body must include \`## R-level compliance\` (paste the PASS output) and \`Closes ${issue_id}\`.
7. Post an EXECUTOR_RESULT comment on the PR (schema: executor-result/v1) referencing the exact current head SHA and the proof artifact path.

Return the PR URL and final head SHA as the last line of your output — the orchestrator reads this to start Phase 5 review.`
})
```

Multiple Claude lanes may be dispatched this way concurrently — one `Agent` call per lane, up to the Claude executor slots `ops:execution-state` reports. Each must already have a distinct worktree path and a disjoint `file_scope_lock` (Phase 3's parallel dispatch guard is unconditional, not just for Codex). This is what produces overlapping execution windows across lanes; the orchestrator's own timeline is just dispatch calls plus completion notifications, not lane implementation work.

**T2/T3 Claude lanes:** No planning subagent — go straight to the background execution step above.

The background agent's own instructions (steps 1–7 above) cover what used to be the separate "before opening PR" batch sequence for Claude lanes — `pnpm verify`, R-level check plus any flagged artifacts, `pnpm test:db` for T1, `gh pr create`, and the executor-result comment. Tier label is auto-applied by `ops:lane-finalize` — no manual `gh pr edit --add-label` needed; verify CI picks up the label before merge.

**Codex lanes** (T2 clear-scope, only when Codex health check passes):
- Execute via the canonical Codex entry point — never call `codex exec` or `codex run` directly:
  ```bash
  npx tsx scripts/ops/codex-exec.ts --issue UTV2-{number}
  ```
  This script reads the lane manifest, embeds `agent-brief.md`, validates CWD, and runs Codex with standardized args. It also reads the manifest's `model_routing` block (or the documented legacy default for manifests predating it, with a visible warning), validates it against `docs/05_operations/policies/codex-model-routing.json`, and passes the resolved model and reasoning effort explicitly to `codex exec` — it never relies on the CLI's own default model. `--dry-run` flag previews the resolved profile/model/effort and the prompt without executing.
- Codex must complete the following before opening the PR:

**Before opening PR — required for all lanes:**

**Batch A — run these two in parallel (single message, two Bash tool calls):**
- `pnpm verify` — full pipeline (env:check + lint + type-check + build + test) — must exit 0
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — note triggered rules

If `pnpm verify` fails, fix and re-run. If R-level flags missing artifacts, generate them in **Batch B**:

**Batch B — run in parallel only if needed (artifacts flagged by R-level):**
- `r3-shadow-report`: `tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json` (skip if file not found)
- `qa-experience-report`: `pnpm qa:experience --regression --mode fast` (skip if file not found)

**Batch C — final confirmation:**
Re-run `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — must PASS.
Paste the PASS output into PR body under `## R-level compliance`.

- After Codex opens the PR, tier label is auto-applied by `ops:lane-finalize` — no manual `gh pr edit --add-label` needed. Verify CI picks up the label before review.
- Report that Codex lane is dispatched and will need review on return

### Phase 5: Concurrent execution for multiple lanes

Claude lanes are no longer single-threaded. Both executors run their implementation step as background agents, and the orchestrator's job for either is identical from here: dispatch, wait for a completion notification, review, merge, close. Never implement a lane directly in the orchestrator session, for either executor.

1. Dispatch every validated Claude lane via Phase 4's background `Agent` call (one call per lane) — do not execute any of them directly.
2. Dispatch every validated Codex lane via `npx tsx scripts/ops/codex-exec.ts --issue UTV2-{number}`, wrapped in a background call the same way.
3. Continue other control-plane work (board reads, monitoring) — you will be **automatically notified** when each background lane completes, Claude or Codex.
4. On any lane's completion notification, spawn a background review agent — do not review inline in the orchestrator session. The same reviewer works for a returned Claude-lane PR as for Codex; it inspects the diff, not who wrote it:

```typescript
Agent({
  run_in_background: true,
  model: touchesTierC ? "opus" : "sonnet",  // tier C paths → opus critique
  subagent_type: "codex-return-reviewer",
  description: `Lane return review: ${issue_id}`,
  prompt: `Review the returned diff for ${issue_id} (executor: ${executor}).
PR: ${pr_url}
Branch: ${branch}

Steps:
1. Read the diff via: gh pr diff ${pr_number}
2. Run the codex-return-reviewer checks (file scope, Tier C paths, test existence, commit format, tier label, R-level) — these apply the same way regardless of which executor produced the diff
3. Check if diff touches any Tier C path: packages/domain/, packages/contracts/, supabase/migrations/, packages/db/src/lifecycle.ts, apps/api/src/auth.ts
4. Post review result as Linear comment on ${issue_id}
5. If REJECT or Tier C violation found: post a blocking comment on the PR and set Linear state to Blocked

Return: APPROVE or REJECT with findings.`
})
```

**Tier C detection:** Before spawning, check the PR diff with `gh pr diff --name-only <pr>`. If output contains any Tier C path, use `model: "opus"`. Otherwise `model: "sonnet"`.

**Optional additional Fable advisory review (UTV2-1569) — never a replacement for the codex-return-reviewer critique above:** if this lane matches one of the four ratified Fable pilot trigger classes (most likely `repeated_architecture_bounce` if this PR has already bounced `CHANGES_REQUIRED` more than once on the same architectural question, or `build_mode_certification_review` for a certification packet), call `resolveFableAdvisoryReview()` (`scripts/ops/planning-model-routing.ts`) with `reviewerIndependentOfAuthor: true` before spawning. If it resolves to `claude-fable-5`, spawn an ADDITIONAL ad-hoc background agent (no `subagent_type` — same pattern as the T1 planning subagent in Phase 4, not a persistent `.claude/agents/` contract) with `model: toAgentModelOverride(resolution.routing.model)` and a prompt instructing it to review the unedited diff (`git diff main`, never an author-curated summary) and post its finding using the `fable-review/v1` schema (`docs/05_operations/schemas/fable-review-v1.md`) — its `FABLE_REVIEW: ADVISORY` output is posted alongside, never instead of, the mandatory critique above, and never gates APPROVE/REJECT or merge. If `resolveFableAdvisoryReview()` falls back to Sonnet (pilot ineligible for any reason) or the trigger class doesn't apply, skip this step entirely — it is optional in every sense the mandatory critique above is not.

5. On APPROVE (and, for T1, after PM_VERDICT): `pnpm ops:merge-wrapper pr-merge --issue UTV2-### --branch <branch> --pr <n> --method squash`, then acquire the closeout mutex and close: `pnpm ops:merge-lock acquire --issue UTV2-### --branch <branch> --reason ops:lane-close` → `pnpm ops:lane-close UTV2-###`. **Merge and close stay fully serialized through the merge mutex regardless of how many lanes finished implementation concurrently** — if two lanes both want to merge around the same time, queue the second: wait for the first's `ops:lane-close` to exit before acquiring the mutex for the next. Concurrent execution windows are fine; concurrent merge/close attempts are not.
6. If abandoning an active lane before work begins, release the lease explicitly:
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
- **CI should confirm, not discover.** Run local preflight before opening a PR — see `docs/05_operations/OPERATING_MODEL_SONNET5.md`.
- **Runtime validation is tier-scoped, not universal.** T1: required when runtime/product behavior is affected. T2: issue-specific/conditional. T3: N/A unless the issue says otherwise.
- **Outcome Contracts are planning artifacts only.** They never replace the lane manifest, `file_scope_lock`, `expected_proof_paths`, R-level checks, or PM gates.
- **Governance cutover is forward-only.** The Outcome Contract / preflight / Rule-9-restated model in this file applies only to lanes opened after `UTV2-WORKFLOW-RESET` merged to main — it does not retroactively apply to lanes already open at that time.

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
