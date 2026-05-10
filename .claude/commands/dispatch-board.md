# /dispatch-board

Board-wide autonomous execution. Reads the entire Linear board, routes every executable issue via `/three-brain`, and runs the full dispatch → execute → verify → close loop until the board is empty or all remaining issues are blocked.

**Usage:**
- `/dispatch-board` — run all executable issues on the board
- `/dispatch-board --milestone <id>` — scope to a specific Linear milestone
- `/dispatch-board --dry-run` — show routing plan without executing
- `/dispatch-board --tier T2` — run only issues of a specific tier this cycle

**Arguments:** `$ARGUMENTS`

---

## Overview

This is the "clear the board" command. You call it once. It runs until the board is empty.

You are notified at exactly two points:
1. **T1 plan gate** — before any T1 implementation starts (PM plan approval required)
2. **T1 merge gate** — after T1 implementation, before merge (PM_VERDICT required)

**T2 clear-scope (Codex) merge gate: Claude diff-review only. No PM_VERDICT required.**

Everything else — routing, lane creation, execution, verification, CI monitoring, merging, Linear updates, lane closes, and next-issue dispatch — runs without interruption.

**This skill owns the loop. `/dispatch` owns the lane.** Never re-implement `/dispatch` logic here — call it.

---

## Phase 1: Read the board

1. Run system state to get current context:
   ```bash
   pnpm ops:brief
   ```

2. Query Linear for all open non-blocked issues via MCP (`mcp__claude_ai_Linear__list_issues`):
   - **Include:** issues in states "Ready", "Ready for Codex", "Ready for Claude", or "Backlog" with a tier label set
   - **Exclude:** "In Claude", "In Codex" (already active), "Done", "Cancelled", "Blocked", and any without a tier label

3. Read current lane state:
   ```bash
   cat .claude/lanes.json
   ```
   Note active lanes, their `file_scope_lock[]`, and current executor slot usage (max 1 Claude, max 2 Codex).

4. Build the candidate list — exclude:
   - Issues whose file scope overlaps any active lane's `file_scope_lock`
   - Issues missing `tier:T1`, `tier:T2`, or `tier:T3` label
   - Issues with unresolved blocking issues (linked blockers not in Done state)
   - Issues with any of these external-gate labels (auto-skip, no qualification needed):
     - `needs:operator-action` — requires human operator action (e.g. populate secrets, buy hardware)
     - `needs:live-data` — requires live SGO or external feed currently unavailable
     - `needs:hetzner` — requires server provisioning not yet complete
     - Log each skip: `[dispatch-board] SKIP UTV2-### — {label}: {title}`
     - Surface in end-of-cycle report under "Deferred (external gate)"

5. If `--milestone <id>`: call `mcp__claude_ai_Linear__get_milestone` and filter candidates to that milestone only.

6. If candidate list is empty after filtering: report what is blocking each issue and stop.

---

## Phase 2: Route the board

Run Codex health check once at the start of this phase:
```bash
npx tsx scripts/ops/codex-health-check.ts --json
```
Note result. If `healthy: false`, all T2 Codex slots route to Claude fallback for this cycle.

Apply routing rules to each candidate (first match wins):

| Rule | Condition | Executor | Gate |
|---|---|---|---|
| T1 | `tier:T1` label | Claude | **T1 plan gate — stop and notify (Phase 3)** |
| Sensitive path | Touches `supabase/migrations/**`, `packages/contracts/src/**`, `packages/domain/src/**`, `packages/db/src/lifecycle.ts`, `packages/db/src/repositories.ts`, `apps/api/src/auth.ts`, `apps/worker/**` | Claude | Griff gate |
| T2 clear-scope | `tier:T2`, not sensitive path, Codex healthy | Codex | Claude diff-review |
| T2 with migration/contract | `tier:T2`, touches migrations or shared contracts | Claude | None |
| T3 | `tier:T3` | Claude | None |
| Codex unavailable | Codex health = false | Claude fallback | None |

For `--dry-run`: emit the routing table and stop. Do not proceed to Phase 3.

```
DISPATCH-BOARD DRY RUN — 2026-MM-DD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Routable this cycle:
  Issue     Title                              Tier  Executor  Gate
  UTV2-871  prune fix                          T2    Codex     none
  UTV2-872  scorer config refactor             T3    Claude    none
  UTV2-873  governance brake audit             T1    Claude    PM plan required

Excluded from this cycle:
  UTV2-800  missing tier label
  UTV2-801  file scope overlap with active lane UTV2-871
  UTV2-802  blocked by UTV2-799 (not Done)

Codex health: OK  |  Claude slots: 1  |  Codex slots: 2
```

---

## Phase 3: T1 gate — stop and notify before implementation

If any T1 issues are in the routing table:

1. **Dispatch all non-T1 issues first** (Phase 4 for non-T1 candidates). Claude is single-threaded — complete non-T1 dispatches before pausing for T1 approval. Do not claim to run things in parallel.

2. After non-T1 dispatch wave is started, surface T1 gates one at a time:
   ```
   [dispatch-board] T1 PLAN GATE — UTV2-### {title}

   T1 requires PM plan approval before implementation begins.
   Review the acceptance criteria and confirm the approach.

   Reply "approved UTV2-###" to begin this T1 lane.
   Reply "skip UTV2-###" to defer to the next cycle.
   ```

3. Wait for your response before opening any T1 lane. Do not proceed on T1 without explicit approval.

4. On "approved UTV2-###": open the T1 Claude lane and execute (Phase 4 T1 path).

5. On "skip UTV2-###": remove from this cycle, note in end-of-session report.

---

## Phase 4: Dispatch

Respect lane capacity at all times:
- **Max 1 Claude lane active** — queue additional Claude candidates
- **Max 2 Codex lanes active** — queue additional Codex candidates

For each issue being dispatched in this phase, call:
```
/dispatch UTV2-###
```

`/dispatch` handles everything for the lane: branch creation, lane manifest, Linear state update, file-scope lock, worktree (Codex), implementation or Codex packet, pre-PR verification, tier label, PR opening. Do not duplicate that logic here.

Dispatch order:
1. Any approved T1 Claude lanes first
2. Non-T1 Claude lanes (T3, T2-migration, T2-fallback) — one at a time, sequentially
3. Codex lanes — up to 2 in parallel

---

## Phase 5: Monitor → verify → close loop

Enter this loop after the initial dispatch wave. Continue until all candidates are closed or blocked.

### Claude lanes (you are the executor)

After implementation and PR open:
1. Confirm CI is green on the PR
2. Run `/verification` checklist (tier-appropriate)
3. Run `ops:truth-check UTV2-###`
4. Pre-merge conflict check:
   ```bash
   gh pr view <number> --json mergeable --jq .mergeable
   ```
   If `CONFLICTING`: `git rebase origin/main && git push --force-with-lease` then re-check.
   (Root cause: sister PR merged to main after this branch diverged — standard rebase resolves it.)
5. On PASS:
   - Merge the PR: `gh pr merge <number> --squash`
   - Update Linear to Done via MCP
   - Close lane manifest (`status: done`)
   - Free the file-scope lock
   - Check queue → dispatch next Claude candidate if any
5. On FAIL:
   - Mark lane blocked with the specific failing check
   - Do not close the lane
   - Check queue → dispatch next Claude candidate from the unblocked pool

### Codex lanes (async — requires explicit check-in)

Codex runs independently in a separate session. It does NOT auto-signal completion. After dispatching Codex lanes, output a check-in instruction:

```
[dispatch-board] Codex lane(s) dispatched: UTV2-### [, UTV2-###]
When Codex finishes and opens its PR(s), run: /dispatch-board --check-codex
This will review the returned diffs and trigger merge if clean.
```

On `/dispatch-board --check-codex`: query GitHub for open PRs on active Codex branch names, then proceed with the review flow below.

When a Codex PR is available for review:
1. Review the diff:
   - Files changed are within the declared `file_scope_lock`
   - No scope bleed into other packages
   - `pnpm verify` output is in the PR description and is green
   - R-level compliance section is present and passing
2. Pre-merge conflict check:
   ```bash
   gh pr view <number> --json mergeable --jq .mergeable
   ```
   If `CONFLICTING`: checkout the Codex branch, rebase onto `origin/main`, force-push, then continue.
3. **T2 clear-scope merge gate: Claude diff-review is the sole gate. No PM_VERDICT required.**
   On clean review:
   - Approve the PR: `gh pr review <number> --approve`
   - Merge: `gh pr merge <number> --squash`
   - Update Linear to Done via MCP
   - Close lane manifest
   - Free the slot → dispatch next Codex candidate
4. On scope bleed or verify failure:
   - Leave PR open
   - Mark lane blocked with specific reason
   - Free the slot → dispatch next Codex candidate from unblocked pool

### T1 lanes — merge gate

After T1 implementation, PR open, and evidence bundle generated:
1. Confirm `pnpm test:db` is in PR body and green
2. Confirm evidence bundle path is in PR body
3. Output the merge gate notice:
   ```
   [dispatch-board] T1 MERGE GATE — UTV2-### {title}

   PR #NNN is ready. Evidence bundle generated. Awaiting PM_VERDICT.

   Please post this comment on PR #NNN:

   PM_VERDICT: APPROVED
   schema: pm-verdict/v1
   Issue: UTV2-###
   ```
4. Wait. Do not merge without a PM_VERDICT comment on the PR.
5. On approval detected (PM_VERDICT: APPROVED on the PR):
   - Merge: `gh pr merge <number> --squash`
   - Run Fibery proof sync: `source local.env && export FIBERY_API_URL FIBERY_API_TOKEN && npx tsx scripts/ops/fibery-proof-sync.ts UTV2-###`
   - Update Linear to Done
   - Close lane manifest

---

## Phase 6: End-of-cycle report

When the queue is empty and all active lanes have resolved (closed or blocked):

```
DISPATCH-BOARD — CYCLE COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Merged this cycle:
  ✓ UTV2-871 [T2/Codex]  → PR #614 merged (SHA abc1234)
  ✓ UTV2-872 [T3/Claude] → PR #615 merged (SHA def5678)

Awaiting PM action:
  ⏳ UTV2-873 [T1/Claude] → PR #616 open — awaiting PM_VERDICT

Blocked this cycle:
  ✗ UTV2-874 [T2/Codex]  → scope bleed into packages/domain — PR left open for review
  ✗ UTV2-875 [T3/Claude] → ops:truth-check FAIL: pnpm test count decreased

Deferred (not dispatched):
  — UTV2-876 missing tier label
  — UTV2-877 blocked by UTV2-873 (not Done)

Deferred (external gate):
  — UTV2-878 [needs:live-data] — SGO unavailable
  — UTV2-879 [needs:operator-action] — GitHub secrets unpopulated

Board: 2 merged, 1 awaiting PM, 2 blocked, 2 deferred, 2 external-gate
```

After all merges in the cycle, reset sync.yml and commit:
```bash
# Reset sync.yml to neutral after last merge of the cycle
git checkout main && git pull --ff-only
# Edit .ops/sync.yml → entities.issues: []
git add .ops/sync.yml
git commit -m "ops: reset sync.yml to neutral after merge [skip ci]"
git push origin main
```

If issues remain after the cycle: summarize what's needed to unblock each one.

---

## Rules

- **Never start T1 without PM plan approval.** T1 lanes hold at `pending_pm_approval` until you say "approved UTV2-###".
- **Never merge T1 without PM_VERDICT on the PR.** The comment must be on the PR, not in chat.
- **T2 clear-scope (Codex): Claude diff-review is the sole gate.** No PM_VERDICT required. `gh pr review --approve` then merge.
- **Auto-skip external-gate labels.** `needs:operator-action`, `needs:live-data`, `needs:hetzner` → skip silently, surface in report. No user qualifier needed.
- **Max 1 Claude lane at a time.** Queue — never stack.
- **Max 2 Codex lanes at a time.** Per executor routing defaults.
- **Call `/dispatch`, don't re-implement it.** This skill owns the loop; `/dispatch` owns the lane.
- **Fail closed.** If verification fails or scope is unclear, mark blocked. Never auto-close a failing lane as Done.
- **No scope overlap.** Check `file_scope_lock` before every dispatch. Refuse overlap — do not ask.
- **Codex lanes are async.** Dispatch and continue. Review only when Codex returns a PR.
- **Board truth over Linear truth.** If `lanes.json` says active but Linear says Done, reconcile before dispatching. Do not assume Linear is right.
- **Commit messages must include issue ID.** Format: `type(scope): UTV2-### description`
