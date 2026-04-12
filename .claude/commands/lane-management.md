# /lane-management

Govern the lifecycle of an execution lane — from `ops:lane:start` to `ops:lane:close`. Apply whenever you are beginning, progressing, blocking, reopening, or closing work on a Linear issue.

**Canonical spec:** `docs/05_operations/LANE_MANIFEST_SPEC.md`
**Truth model:** `docs/05_operations/EXECUTION_TRUTH_MODEL.md`

---

## When this skill applies

Apply automatically when:
- starting work on any Linear issue
- opening a worktree or branch for execution
- handing a task to a Codex CLI lane
- a lane has been idle and you are about to resume
- an issue is blocked and needs to be recorded as such
- you are about to claim an issue is complete
- reconciling Linear state against repo reality
- reviewing another lane's state before touching overlapping files

---

## Core principle

**The lane manifest is the sole authority for active lane state.** Not Linear. Not chat. Not memory. A lane without a manifest at `docs/06_status/lanes/<UTV2-###>.json` does not exist.

Linear is patched *from* the manifest on close. Never the reverse.

---

## Lane lifecycle (canonical states)

```
Ready ──▶ Lane Started ──▶ In Progress ──▶ In Review ──▶ Merged ──▶ Done
                │                │              │            │
                ▼                ▼              ▼            ▼
             Blocked         Blocked        Blocked       Reopened
```

| State | Enters Via | Exits Via |
|---|---|---|
| Ready | Linear tier label + acceptance criteria + allowed files | `ops:lane:start` |
| Lane Started | manifest created, preflight token valid, worktree + branch + file locks | first commit pushed |
| In Progress | commits landing | PR opened |
| In Review | PR open | PR merged to `main` |
| Merged | merge commit on `main` first-parent | `ops:truth-check` passes |
| Done | truth-check pass recorded, manifest closed | — (terminal) |
| Blocked | explicit blocker or stranded heartbeat | blocker resolved |
| Reopened | truth-check exit `4` post-Done | re-entry to In Progress after ack |

---

## Required commands (the only sanctioned lane transitions)

| Command | Purpose |
|---|---|
| `ops:preflight` | verifies env, git, deps, secrets; emits preflight token |
| `ops:lane:start <UTV2-###>` | creates manifest, worktree, branch, file locks |
| `ops:lane:close <UTV2-###>` | runs truth-check, transitions Linear, closes manifest |
| `ops:truth-check <UTV2-###>` | the done-gate |
| `ops:lane:resume <UTV2-###>` | re-runs preflight and resumes a stranded/blocked lane |
| `ops:lane:block <UTV2-###>` | explicitly mark blocked with reason |

**No lane may start without a valid preflight token. No lane may be closed without a passing truth-check.** These are hard gates, not conventions.

If `ops:*` commands are not yet implemented, follow the same discipline manually and record equivalent state in the manifest artifact — but flag the gap.

---

## Lane start discipline

Before starting a lane, confirm:

**[ ] Issue has a tier label** (`t1`, `t2`, or `t3`). No tier → not Ready → cannot start.

**[ ] Preflight passed.** Valid preflight token from the current session. Stale tokens are refused.

**[ ] File scope is declared.** `file_scope_lock[]` lists the files this lane claims. Globs allowed.

**[ ] No overlap.** No other active manifest (`status ∈ {started, in_progress, in_review, blocked, reopened}`) declares overlapping file scope.

**[ ] Expected proof paths declared.** `expected_proof_paths[]` is tier-appropriate and not empty for T1/T2.

**[ ] One manifest per issue.** If a prior manifest exists for this issue, it must be `done` before a new one is created.

If any of these fail, **do not start the lane**. Report the blocker and stop.

---

## Manifest role

The manifest is:

- created by `ops:lane:start`
- updated on every `ops:*` call and every commit (heartbeat)
- finalized at merge with `commit_sha`, `pr_url`, `files_changed`
- closed by `ops:lane:close` after truth-check passes
- never deleted — closed manifests remain for audit

The manifest is authoritative for: **what lane exists, where it is working, what it is touching, what it promises to prove, and its current lifecycle state.**

The manifest is **not** authoritative for: shipped code (use `main`), CI outcomes on merge (use GitHub), issue intent (use Linear), completion (use truth-check output).

---

## Heartbeat discipline

Every sanctioned `ops:*` call updates `heartbeat_at`. Agents should not need to think about heartbeats — they happen as a side effect of running sanctioned commands.

| Condition | Threshold | Action |
|---|---|---|
| Fresh | < 4h | normal |
| Stale | 4–24h | flagged in `ops:reconcile`, appears in daily digest |
| Stranded | > 24h | auto-transitioned to Blocked with `blocked_by: ["stranded"]` |
| Orphaned | branch deleted but manifest active | flagged, requires manual close |

**Resuming from stranded** requires `ops:lane:resume <issue>`, which re-runs preflight and verifies file-scope locks are still valid.

---

## File-scope lock discipline

`file_scope_lock` is declared once, at lane start, and is immutable for the life of the lane.

- Overlap check is hard. The second lane is refused. The only resolutions are: wait for the conflicting lane to close, or redefine scope.
- Widening scope requires explicit `ops:lane:relock`.
- Locks are released on `status: done`. Blocked and reopened lanes retain their locks — **you cannot start a second lane on files held by a blocked lane.**
- Globs expand to absolute paths. `apps/api/src/**` overlaps with `apps/api/src/foo.ts`.

Before editing files outside your lane's declared scope, stop and ask. Scope bleed in Codex returns is a rejection reason.

---

## Blocked lanes

A lane moves to Blocked when:
- an explicit blocker is recorded via `ops:lane:block` (reason required)
- heartbeat passes the 24h stranded threshold
- a dependency issue is not yet truth-check-passing
- environment or infrastructure prevents progress and cannot be resolved in-session

A blocked lane:
- retains its manifest, branch, worktree, and file-scope lock
- appears in the daily digest until unblocked
- blocks any new lane attempting to touch its locked files
- must be resumed via `ops:lane:resume` (re-runs preflight)

**Do not** silently abandon a blocked lane. **Do not** start a new lane on overlapping scope "to make progress." Unblock or close with explicit override.

---

## Reopened lanes

A reopened lane entered post-Done because truth-check detected drift. Treatment:

- The manifest `status` becomes `reopened`, `reopen_history[]` appended.
- A **new lane may not be started** on the same issue until the reopen reason is acknowledged via `ops:lane:resume <issue> --ack <reason_id>`.
- The fix must address the specific failing check — not a cosmetic re-close.
- After the fix, re-run `ops:truth-check`. Only a fresh pass clears the reopen.

Reopens are mechanical. Treat them as a bug signal, not a paperwork item.

---

## Red flags — stop if you see these

- Starting work with no manifest, no branch, or no preflight token
- Two active manifests declaring overlapping file scope
- A manifest `status: merged` that has been sitting without a truth-check run
- A reopened lane being closed without running truth-check again
- "I'll just touch this one file in the other lane's scope"
- Linear being patched by hand to Done without running `ops:lane:close`
- A Codex lane with no `task_packet_hash` set — scope-diff cannot validate its return
- Writing a blocker to Linear comments instead of `blocked_by`

Report the violation before proceeding.

---

## Output format (when invoked explicitly)

```
## Lane Management Check

### Lane under review
Issue: UTV2-###
Manifest path: docs/06_status/lanes/UTV2-###.json

### State
status: [started | in_progress | in_review | merged | done | blocked | reopened]
tier: [T1|T2|T3]
branch: [name]
worktree: [path]
heartbeat age: [duration]

### Scope
file_scope_lock: [list]
overlap with other active lanes: NONE / CONFLICT with [issue]

### Lifecycle readiness
preflight token: VALID / STALE / MISSING
expected proof paths: SET / MISSING
truth_check_history: [last entry summary or "none"]

### Verdict
OK — [what to do next]
— or —
BLOCKED — [precise blocker]
— or —
VIOLATION — [which rule, which artifact]
```
