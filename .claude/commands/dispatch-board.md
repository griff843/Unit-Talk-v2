# /dispatch-board

Board-wide autonomous loop. Reads the entire Linear board, routes every executable issue via `/three-brain`, and runs the dispatch → execute → verify → close cycle until the board is empty or all remaining issues are blocked.

**Usage:**
- `/dispatch-board` — run all executable issues
- `/dispatch-board --milestone <id>` — scope to a Linear milestone
- `/dispatch-board --dry-run` — show routing plan without executing
- `/dispatch-board --tier T2` — restrict to a single tier this cycle
- `/dispatch-board --check-codex` — review returned Codex PRs (async re-entry)

**Arguments:** `$ARGUMENTS`

---

## Ownership boundary

**This skill owns the loop. `/dispatch` owns the lane. `/three-brain` owns routing.** Never re-implement either here — call them.

You are notified at exactly two points:
1. **T1 plan gate** — before any T1 implementation (per `/three-brain` Rule 1 + Rule 9)
2. **T1 merge gate** — after T1 implementation, before merge (PM_VERDICT required)

T2 clear-scope (Codex) merge gate: Claude diff-review only. No PM_VERDICT.

---

## Phase 1: Read the board

1. `pnpm ops:brief` — current context
2. Query Linear (MCP `mcp__claude_ai_Linear__list_issues`):
   - **Include:** Ready / Ready for Codex / Ready for Claude / Backlog with a tier label
   - **Exclude:** In Claude, In Codex (already active), Done, Cancelled, Blocked, untiered
3. `cat .claude/lanes.json` — note active lanes, `file_scope_lock[]`, slot usage (max 1 Claude, max 2 Codex)
4. Build candidate list — exclude:
   - File-scope overlap with any active lane
   - Missing tier label
   - Linked blockers not in Done
   - External-gate labels (skip silently, surface in report):
     - `needs:operator-action`, `needs:live-data`, `needs:hetzner`
5. If `--milestone <id>`: filter via `mcp__claude_ai_Linear__get_milestone`
6. Empty after filtering → report what blocks each issue and stop

---

## Phase 2: Route

Call `/three-brain` for each candidate. Routing rules, executor selection, Codex health check, sensitive-path detection, and Griff escalations all live there — do not duplicate.

For `--dry-run`: emit the routing table and stop.

```
DISPATCH-BOARD DRY RUN — 2026-MM-DD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Routable this cycle:
  Issue     Title                              Tier  Executor  Gate
  UTV2-871  prune fix                          T2    Codex     none
  UTV2-872  scorer config refactor             T3    Claude    none
  UTV2-873  governance brake audit             T1    Claude    PM plan required

Excluded:
  UTV2-800  missing tier label
  UTV2-801  file scope overlap with active lane UTV2-871
  UTV2-802  blocked by UTV2-799 (not Done)

Codex health: OK  |  Claude slots: 1  |  Codex slots: 2
```

---

## Phase 3: T1 gate

If any T1 in routing:

1. Dispatch all non-T1 issues first (Claude is single-threaded; complete non-T1 before pausing)
2. Surface T1 gates one at a time:
   ```
   [dispatch-board] T1 PLAN GATE — UTV2-### {title}
   Reply "approved UTV2-###" to begin, "skip UTV2-###" to defer.
   ```
3. Wait for explicit approval before opening any T1 lane

---

## Phase 4: Dispatch

For each approved issue: `/dispatch UTV2-###`. That skill owns branch creation, lane manifest, Linear state, file-scope lock, worktree (if Codex), pre-PR verification, R-level check, tier label, PR opening.

Dispatch order:
1. Approved T1 Claude lanes first
2. Non-T1 Claude lanes — sequentially (max 1 active)
3. Codex lanes — up to 2 in parallel

---

## Phase 5: Monitor → verify → close

### Claude lanes (you are the executor)

After PR open:
1. CI green on PR
2. Run `/verification` (tier-appropriate)
3. `ops:truth-check UTV2-###`
4. Pre-merge conflict check: `gh pr view <n> --json mergeable --jq .mergeable` → if `CONFLICTING`, rebase on `origin/main` and force-push
5. On PASS: `gh pr merge <n> --squash` → Linear Done → close manifest → dispatch next Claude candidate
6. On FAIL: mark blocked with specific failing check → dispatch next from unblocked pool

### Codex lanes (async)

After dispatching: emit check-in instruction.
```
[dispatch-board] Codex lane(s) dispatched: UTV2-### [, UTV2-###]
When Codex finishes and opens its PR(s), run: /dispatch-board --check-codex
```

On `--check-codex`: query GitHub for open PRs on active Codex branches, then for each:
1. Diff review — files within `file_scope_lock`, no scope bleed, `pnpm verify` + R-level section present and green
2. Conflict check; rebase if needed
3. Clean → `gh pr review <n> --approve` → `gh pr merge <n> --squash` → Linear Done → close manifest → dispatch next Codex candidate
4. Scope bleed / verify failure → leave PR open, mark blocked, dispatch next

### T1 merge gate

After T1 PR open + evidence bundle:
1. Confirm `pnpm test:db` in PR body and green
2. Confirm evidence bundle path in PR body
3. Surface merge gate:
   ```
   [dispatch-board] T1 MERGE GATE — UTV2-### {title}
   Post on PR #NNN:
     PM_VERDICT: APPROVED
     schema: pm-verdict/v1
     Issue: UTV2-###
   ```
4. On `PM_VERDICT: APPROVED` detected: merge → Fibery proof sync → Linear Done → close manifest

---

## Phase 6: End-of-cycle report

```
DISPATCH-BOARD — CYCLE COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Merged this cycle:
  ✓ UTV2-871 [T2/Codex]  → PR #614 merged (SHA abc1234)
  ✓ UTV2-872 [T3/Claude] → PR #615 merged (SHA def5678)

Awaiting PM action:
  ⏳ UTV2-873 [T1/Claude] → PR #616 open — awaiting PM_VERDICT

Blocked this cycle:
  ✗ UTV2-874 [T2/Codex]  → scope bleed into packages/domain — PR left open
  ✗ UTV2-875 [T3/Claude] → ops:truth-check FAIL: pnpm test count decreased

Deferred (external gate):
  — UTV2-878 [needs:live-data] — SGO unavailable
  — UTV2-879 [needs:operator-action] — GitHub secrets unpopulated

Board: 2 merged, 1 awaiting PM, 2 blocked, 2 deferred
```

After all merges, reset sync.yml:
```bash
git checkout main && git pull --ff-only
# edit .ops/sync.yml → entities.issues: []
git add .ops/sync.yml && git commit -m "ops: reset sync.yml to neutral after merge [skip ci]" && git push
```

---

## Rules

- **Never start T1 without PM plan approval.** Hold at `pending_pm_approval`.
- **Never merge T1 without PM_VERDICT on the PR.** Comment must be on the PR, not in chat.
- **T2 clear-scope: Claude diff-review is the sole gate.** No PM_VERDICT.
- **P0 lanes never auto-merge.** Before any merge attempt, run `pnpm ops:p0-detect <UTV2-###>`. If `is_p0: true`, the merge protocol (UTV2-948) overrides tier policy: the orchestrator surfaces the merge gate to PM and waits. PM merges manually. Required artifacts: `docs/06_status/proof/<UTV2-###>/claude-critique.md` and `runtime-verification.md`, both checked by the `P0 Protocol` workflow before merge is allowed.
- **Auto-skip external-gate labels.** No user qualifier needed.
- **Max 1 Claude lane, max 2 Codex lanes.** Queue — never stack.
- **No scope overlap.** Check `file_scope_lock` before every dispatch.
- **Codex lanes are async.** Dispatch and continue. Review on `--check-codex` re-entry.
- **Board truth over Linear truth.** If `lanes.json` says active but Linear says Done, reconcile before dispatching.
