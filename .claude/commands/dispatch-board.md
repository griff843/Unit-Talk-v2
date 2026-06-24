# /dispatch-board

Board-wide autonomous loop. Reads the entire Linear board, routes every executable issue via `/three-brain`, and runs the dispatch → execute → verify → close cycle until the board is empty or all remaining issues are blocked.

## Mandatory merge wrapper

All PR merge, PR branch refresh, and post-merge `main` sync operations must go through `pnpm ops:merge-wrapper`. Do not call `gh pr merge`, `gh pr update-branch`, `git pull origin main`, `git merge origin/main`, or `git rebase origin/main` directly; the wrapper owns the merge mutex and records deferred auto-merge state for later reconciliation.

## Parallel lane isolation

`/dispatch-board` may schedule multiple issues in parallel only when each lane runs in its own git worktree. The main checkout is reserved for board control, reconciliation, and serialized merge/closeout operations. Do not dispatch parallel lanes by checking out each branch on the main checkout.

Before counting a lane as active, confirm `/dispatch` started it through `pnpm ops:lane-start` and recorded a lane-specific `worktree_path`/cwd. If worktree creation or isolated install verification fails, do not consume a parallel slot; mark the issue blocked with the specific setup failure.

Worktrees increase execution concurrency, not merge concurrency. PR merge, branch refresh, Linear Done transition, and lane closeout remain one-at-a-time through the merge mutex.

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

## Phase 0: Live safety gates

Before reading the board, run the same live governor and reconciliation sequence as `/dispatch` and `/loop-dispatch`. Abort on any hard fail or block.

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
[dispatch-board] HALTED — live governor blocked: {top condition}. Resolve the block before reading the board.
```

If reconciliation does not pass, surface exactly one repair command from the first repair-plan action and stop before dispatching:

```
[dispatch-board] HALTED — reconciliation drift detected.
Repair command: {first repair_plan action command | none available}
```

## Phase 1: Read the board

1. `pnpm ops:brief` — current context
2. Query Linear (MCP `mcp__claude_ai_Linear__list_issues`):
   - **Include:** Ready / Ready for Codex / Ready for Claude / Backlog with a tier label
   - **Exclude:** In Claude, In Codex (already active), Done, Cancelled, Blocked, untiered
3. Read `docs/06_status/lanes/*.json` — enumerate active manifests (`status ∈ {started, in_progress, in_review, blocked, reopened}`), note `file_scope_lock[]`, executor counts, and worktree paths. Slot limits come from `docs/governance/CONCURRENCY_CONFIG.json` through the live gate outputs; see `docs/governance/LANE_CONCURRENCY_POLICY.md §10`.
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

Codex health: OK  |  Claude slots: {available}/{configured}  |  Codex slots: {available}/{configured}
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

For each approved issue: `/dispatch UTV2-###`. That skill owns branch creation, lane manifest, Linear state, file-scope lock, dedicated worktree creation/resume, pre-PR verification, R-level check, tier label, and PR opening.

Dispatch order:
1. Approved T1 Claude lanes first
2. Non-T1 Claude lanes — within the Claude slots reported by `ops:execution-state`
3. Codex lanes — within the Codex slots reported by `ops:execution-state`

Parallel dispatch guard:
- Every active implementation lane must have a distinct worktree path.
- No active implementation lane may use the main checkout as its execution cwd.
- File-scope locks must be disjoint before dispatching the next lane.
- Shared merge/control files (`package.json`, `.github/workflows/**`, `.ops/sync/**`, `docs/06_status/lanes/**`) count as overlap unless the board explicitly serializes those lanes.

---

## Phase 5: Monitor → verify → close

### Claude lanes (you are the executor)

**Pre-merge verification is not `ops:truth-check`.** `ops:truth-check` is the **done-gate**: it requires a merged/Done lane and the merge SHA, so it cannot pass before merge. `ops:lane-close` runs it *after* merge. Pre-merge, validate merge-readiness with verification + proof-check + merge-ready + R-level; never call `ops:truth-check` to "pass" a branch before merge.

After PR open:
1. CI green on PR (on the PR head)
2. Run `/verification` (tier-appropriate)
3. Confirm merge-readiness pre-merge (NOT truth-check):
   - proof artifacts present and well-formed: `pnpm ops:proof-check --issue UTV2-###`
   - merge-readiness: `pnpm ops:merge-ready --issue UTV2-### --pr <n>`
   - R-level required artifacts present: `npx tsx scripts/ci/r-level-check.ts --issue UTV2-###`
4. Pre-merge diagnostic: `pnpm ops:pr-block-diagnostic --pr <n>` → if genuine branch update is required, run `pnpm ops:merge-wrapper pr-update-branch --issue UTV2-### --branch <branch> --pr <n>`
5. On PASS: `pnpm ops:merge-wrapper pr-merge --issue UTV2-### --branch <branch> --pr <n> --method squash`
6. Acquire closeout mutex ownership, then close: `pnpm ops:merge-lock acquire --issue UTV2-### --branch <branch> --reason ops:lane-close` → `pnpm ops:lane-close UTV2-###`
7. `ops:lane-close` runs `ops:truth-check` (the done-gate, against the merge SHA) and owns Linear Done, manifest closeout, dispatch lease release, and merge mutex release. If `ops:lane-close` exits non-zero, the lane is **merged-but-not-closed** — repair and re-run close before moving on.
8. After `ops:lane-close` exits 0: `pnpm ops:lane-clean UTV2-###` — prunes the closed lane's git worktree. Non-blocking: if worktree already absent, command exits 0.
9. Then dispatch next Claude candidate.
10. On pre-merge FAIL: mark blocked with the specific failing check → dispatch next from unblocked pool.

### Codex lanes (async)

After dispatching: emit check-in instruction.
```
[dispatch-board] Codex lane(s) dispatched: UTV2-### [, UTV2-###]
When Codex finishes and opens its PR(s), run: /dispatch-board --check-codex
```

On `--check-codex`: query GitHub for open PRs on active Codex branches, then for each:
1. Diff review — files within `file_scope_lock`, no scope bleed, `pnpm verify` + R-level section present and green
2. Run `pnpm ops:pr-block-diagnostic --pr <n>`; if a genuine branch update is required, run `pnpm ops:merge-wrapper pr-update-branch --issue UTV2-### --branch <branch> --pr <n>`
3. Clean → `gh pr review <n> --approve` → `pnpm ops:merge-wrapper pr-merge --issue UTV2-### --branch <branch> --pr <n> --method squash`
4. Acquire closeout mutex ownership, then close: `pnpm ops:merge-lock acquire --issue UTV2-### --branch <branch> --reason ops:lane-close` → `pnpm ops:lane-close UTV2-###`
5. `ops:lane-close` owns Linear Done, manifest closeout, dispatch lease release, and merge mutex release.
6. After `ops:lane-close` exits 0: `pnpm ops:lane-clean UTV2-###` — prunes closed worktree.
7. Then dispatch next Codex candidate.
6. Scope bleed / verify failure → leave PR open, mark blocked, dispatch next

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
4. On `PM_VERDICT: APPROVED` detected: run `pnpm ops:merge-wrapper pr-merge --issue UTV2-### --branch <branch> --pr <n> --method squash`, then `pnpm ops:merge-lock acquire --issue UTV2-### --branch <branch> --reason ops:lane-close`, then `pnpm ops:lane-close UTV2-###`.

### Gate matrix — when is a PM verdict required?

Not every lane needs a PM verdict; not every T2 is auto-merge. Decide the gate from the lane's **risk class**, not just its tier:

| Risk class | Examples | Gate |
|---|---|---|
| T2 docs / spec | requirements docs, spec markdown | Claude diff-review only — **no** PM verdict |
| T2 hygiene / config | lane configs, lockfile, lint config | No PM **unless** it changes governance-critical command behavior (e.g. `/dispatch*`, `/loop-dispatch`, merge-wrapper, concurrency config) → then PM-visible |
| T2 monitoring / read-only | monitor extensions, additive metrics | No PM **unless** it carries live-prod credential or change risk |
| T2 runtime / deploy / prod-behavior | ingestor/runtime code, deploy workflows | **PM-visible gate** before merge |
| T2 DB / retention / migration-like | retention jobs, data lifecycle | **Explicit PM approval** required |
| T1 | any T1 lane | PM **plan** gate + PM **merge** gate |
| P0 | `ops:p0-detect` → `is_p0:true` | Manual PM protocol (UTV2-948); never auto-merge |

When a gate applies, surface it on the PR (not in chat) and wait.

### PM-gate scope — pause the lane, not the board

A surfaced PM gate pauses **only the gated lane**. The board continues to dispatch and close safe, unrelated lanes — **unless** the gated lane holds one of these, which serialize against conflicting work:

- a **singleton** lane type (runtime, migration, modeling, data-canonical)
- a **file-scope lock** that overlaps a queued candidate
- the **merge mutex** (any in-flight merge/closeout)

If the gated lane holds none of those, keep dispatching the rest of the board; the gated lane sits in `awaiting PM` until a verdict lands. Do not idle the whole board on one PM gate.

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
  ✗ UTV2-875 [T3/Claude] → `pnpm ops:truth-check` FAIL: pnpm test count decreased

Deferred (external gate):
  — UTV2-878 [needs:live-data] — SGO unavailable
  — UTV2-879 [needs:operator-action] — GitHub secrets unpopulated

Board: 2 merged, 1 awaiting PM, 2 blocked, 2 deferred
```

After all merges, sync main through the merge wrapper before any ops cleanup:
```bash
pnpm ops:merge-wrapper main-sync --issue UTV2-### --branch main
# If .ops/sync.yml cleanup is still needed, make it a normal ops PR. Do not push directly from the board loop.
```

---

## Rules

- **Never start T1 without PM plan approval.** Hold at `pending_pm_approval`.
- **Never merge T1 without PM_VERDICT on the PR.** Comment must be on the PR, not in chat.
- **T2 clear-scope: Claude diff-review is the sole gate.** No PM_VERDICT — but see the Gate matrix: a T2 that changes governance-critical command behavior, runtime/deploy/prod behavior, or DB/retention behavior is PM-visible.
- **`ops:truth-check` is the post-merge done-gate, never a pre-merge check.** It requires a merged/Done lane + merge SHA; `ops:lane-close` runs it. Pre-merge, gate on verification + proof-check + merge-ready + R-level only.
- **A PM gate pauses the lane, not the board.** Keep dispatching safe unrelated lanes unless the gated lane holds a singleton / file-scope / merge-mutex lock.
- **P0 lanes never auto-merge.** Before any merge attempt, run `pnpm ops:p0-detect <UTV2-###>`. If `is_p0: true`, the merge protocol (UTV2-948) overrides tier policy: the orchestrator surfaces the merge gate to PM and waits. PM merges manually. Required artifacts: `docs/06_status/proof/<UTV2-###>/claude-critique.md` and `runtime-verification.md`, both checked by the `P0 Protocol` workflow before merge is allowed.
- **Auto-skip external-gate labels.** No user qualifier needed.
- **Executor limits are config-backed.** Use `docs/governance/CONCURRENCY_CONFIG.json` through `ops:execution-state` and `ops:lane-maximizer`; do not self-authorize lane expansion or duplicate numeric caps in prose.
- **Singleton and forbidden-combination rules are config-backed.** Runtime, migration, modeling, and data/canonical lanes remain singleton per the live governor model. Queue — never stack.
- **No scope overlap.** Check `file_scope_lock` before every dispatch.
- **Codex lanes are async.** Dispatch and continue. Review on `--check-codex` re-entry.
- **Board truth over Linear truth.** If `docs/06_status/lanes/*.json` manifests say active but Linear says Done, reconcile before dispatching (`pnpm ops:orchestration-reconcile --current --json`).
