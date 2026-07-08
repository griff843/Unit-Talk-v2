# Multi-Agent Worktree Ownership / Session Protocol

**Status:** Canonical
**Authority:** `EXECUTION_TRUTH_MODEL.md`, `LANE_MANIFEST_SPEC.md`, `execution-location-policy.md`
**Issued under:** UTV2-1491

This protocol defines how a human, Claude, Codex, and automation share a repository with parallel lane worktrees without losing track of who owns a session, where commands may run, or which workflow is allowed to mutate lane state.

It does not replace the lane manifest. The manifest remains the only authoritative record for active lane state, file locks, branch, worktree path, heartbeat, PR, and closeout status.

**Why this exists:** on 2026-07-07, the root checkout was found switched to a concurrent session's feature branch mid-orchestration — a second agent had branch-switched the shared root checkout instead of using its own worktree, silently invalidating the orchestrating session's cwd and branch assumptions. This protocol closes that gap.

---

## 1. Ownership Model

A lane has exactly one active implementation owner at a time.

| Owner | Owns | Does Not Own |
|---|---|---|
| Lane executor | Edits inside the lane `file_scope_lock`, lane-local verification, branch commits | Merge, Linear Done, lane finalization from the main checkout |
| Main checkout operator | Branch refresh, PR merge, post-merge finalization, orchestration reconcile | Ad hoc implementation edits for a parallel lane |
| `ops:*` scripts | Manifest creation, heartbeat, locks, closeout state, reconciliation | Unrecorded manual state transitions |

Ownership is derived from the active lane manifest:

- `issue_id` identifies the one issue in the lane.
- `branch` identifies the one branch in the lane.
- `worktree_path` identifies the execution directory for implementation work.
- `file_scope_lock` identifies the paths the lane may modify.
- `execution_location` identifies whether the lane runs in a dedicated worktree or the main checkout.

Chat, memory, status docs, and terminal titles are not ownership records.

---

## 2. Session Start

Every executable lane must start or resume through:

```bash
pnpm ops:lane-start -- <UTV2-###> --tier <T1|T2|T3> --branch <branch> --lane-type <type> --executor <executor> --files <path-or-glob>
```

Dispatch wrappers may build this command, but they must not bypass it. `ops:lane-start` is responsible for:

- creating or resuming the lane manifest
- creating or resuming the git worktree
- reserving the file-scope lock
- verifying concurrency limits
- reporting the exact `worktree_path`
- recording the lane heartbeat

The executor must begin work from the returned `worktree_path`, not from the main checkout, unless the manifest explicitly routes the lane to `execution_location: "main_checkout"`.

Before editing, the executor must verify:

```bash
pwd
git branch --show-current
git status --short --branch
```

Expected state for normal parallel implementation:

- `pwd` equals the manifest `worktree_path`
- current branch equals the manifest `branch`
- working tree contains no unrelated edits

If any check disagrees with the manifest, stop and run reconciliation instead of guessing.

---

## 3. Main Checkout Boundary

The main checkout is the control and merge checkout. It is reserved for:

- branch refresh coordination
- merge mutex operations
- PR merge
- Linear Done transition
- `pnpm ops:lane-finalize`
- `pnpm ops:orchestration-reconcile`
- emergency PM-approved singleton execution

Parallel lane implementation must not be performed by switching branches in the main checkout. This prevents one executor from silently invalidating another executor's cwd, staged changes, build state, or lane ownership.

Normal implementation lanes use a dedicated worktree:

```json
{
  "execution_location": "worktree",
  "worktree_path": ".out/worktrees/<executor>__<issue>-<slug>"
}
```

Control and closeout operations use the main checkout:

```json
{
  "execution_location": "main_checkout",
  "worktree_path": "."
}
```

`execution-location-policy.md` defines the routing rules. If this protocol and that policy disagree about where a command runs, `execution-location-policy.md` wins.

### 3.5. One Agent Per Worktree; No Dev Servers From Root

A worktree's working tree is owned by exactly one agent session at a time. Two sessions must never share the same worktree's working tree concurrently — not the main checkout, not a lane worktree. If a second session needs to review or verify a lane, it creates its own separate worktree rather than checking out or branch-switching an existing one that another session is using.

The root checkout must never run a long-lived dev server (`pnpm dev`, a watch-mode build, a local API/worker process, etc.) during multi-agent work — a running dev server holds the root checkout in whatever branch state it started with, and another session's `main-sync` or branch switch underneath it produces exactly the kind of silent cwd/branch invalidation this protocol exists to prevent. Run dev servers, if needed for manual verification, from a dedicated worktree instead.

---

## 4. Worktree Session Rules

Inside a lane worktree, the executor may:

- edit only paths covered by `file_scope_lock`
- run lane-local verification commands
- commit and push the lane branch
- open or update the lane PR
- run read-only inspection outside the locked paths

Inside a lane worktree, the executor must not:

- merge `main` into another active lane without an explicit branch-refresh instruction
- switch to an unrelated branch
- edit files outside the allowed scope
- create a second branch for the same issue
- close Linear manually
- finalize the lane after merge
- copy `local.env`, `.env`, or `supabase/.temp/**`

Credential exposure for live verification must use:

```bash
npx tsx scripts/link-worktree-env.ts <worktree-path>
```

The helper creates links to approved credential files. Do not copy credentials into a worktree.

---

## 5. File-Scope Ownership

`file_scope_lock` is the lane's exclusive write boundary.

Rules:

- A lane may modify only files covered by its allowed scope and manifest lock.
- A lane may read other files for context.
- `ops:lane-start` refuses overlapping active file locks.
- Blocked and reopened lanes retain their locks.
- Locks release only when the manifest reaches a closed state.

If implementation requires a file outside the lock:

1. Stop work.
2. Record the required path and reason.
3. Ask for a revised lane packet or run the approved relock flow.
4. Do not make partial out-of-scope edits.

Manual "it is probably fine" scope expansion is not allowed.

---

## 6. Heartbeats And Session Continuity

The manifest heartbeat is the session continuity signal. It is updated by sanctioned `ops:*` commands and may be updated by lane tooling during long sessions.

Expected behavior:

- Fresh lane: continue.
- Stale lane: verify whether the owner is still active before taking over.
- Stranded lane: resume only through the sanctioned resume path.
- Orphaned worktree or branch: run reconciliation and stop for repair instructions.

An executor taking over a lane must not rely on terminal scrollback or chat history as the ownership source. It must reload the manifest, inspect `git status`, and verify the current branch and cwd.

---

## 7. Interruption And Handoff

If a lane executor stops before opening a PR, it must leave the lane in one of these states:

| State | Required Action |
|---|---|
| Clean and resumable | leave branch/worktree intact; manifest heartbeat records latest sanctioned activity |
| Blocked | record the blocker through the lane/blocking workflow |
| Out-of-scope need discovered | stop with the required path and reason; do not edit it |
| Verification failure not understood | stop with command, failure summary, and whether baseline was checked |

Before another executor resumes the lane, it must inspect:

```bash
git status --short --branch
git log --oneline --decorate -5
```

If there are uncommitted changes, the resuming executor must determine whether they belong to the lane before editing. Unrelated changes must not be reverted without explicit instruction.

---

## 8. PR And Merge Handoff

The lane executor may open the PR after verification passes and the branch contains only in-scope changes. The PR must reference the issue and include the required verification evidence for the tier.

The lane executor does not mark the issue Done. Done is a post-merge state established by the closeout workflow.

After merge, serialized closeout runs from the main checkout:

```bash
pnpm ops:lane-finalize -- --issue <UTV2-###> --pr <PR-number-or-url> --json
pnpm ops:orchestration-reconcile --current --json
```

Closeout must run under the merge/control discipline because it mutates manifest, GitHub, and Linear truth. It must not run concurrently from a stale lane worktree.

---

## 9. Reconciliation Rules

When sources disagree, use the truth hierarchy from `EXECUTION_TRUTH_MODEL.md`:

1. GitHub `main`
2. Proof bundle tied to merge SHA
3. Lane manifest
4. Linear
5. Chat, memory, and session notes

Common repairs:

| Drift | Resolution |
|---|---|
| Linear says In Progress but no manifest exists | `ops:orchestration-reconcile` returns the issue to Ready or reports a repair |
| PR merged but manifest still says `in_review` | Reconcile/finalize from main checkout |
| Worktree exists but manifest is closed | Reconcile and prune only through approved cleanup |
| Branch exists without active manifest | Treat as orphaned until reconcile classifies it |
| Two sessions claim same issue | Manifest owner wins; the other session stops |
| Cwd does not match manifest `worktree_path` | Stop and move to the manifest path or reconcile |

Do not patch lane state by hand in status files unless a script explicitly instructs that repair.

---

## 9.5. Review Worktrees

Reviewing or fixing an existing PR (no new lane manifest, no new Linear state) uses a lighter-weight pattern than `ops:lane-start` — a plain, disposable `git worktree`, not a lane-registered one. One review worktree per PR being reviewed; never review two PRs from the same worktree, and never review from the main checkout's working tree.

Create:

```bash
git fetch origin <branch-name>
git worktree add /tmp/review-<issue-or-pr> origin/<branch-name>
cd /tmp/review-<issue-or-pr>
git checkout -b <branch-name>-local origin/<branch-name>
```

If a branch is already checked out by an active lane worktree elsewhere, do not force-create a second local branch of the same name — commit on the `-local` branch and push explicitly to the remote branch name instead:

```bash
git push origin HEAD:<branch-name>
```

Remove when done:

```bash
cd /home/griff843/code/Unit-Talk-v2
git worktree remove /tmp/review-<issue-or-pr> --force
```

Review worktrees are scratch space — they are never registered in a lane manifest and never hold `file_scope_lock`. A fix pushed from one still goes through the PR's normal CI and merge-gate checks; this pattern only changes where the edit is made, not how it is authorized to merge.

---

## 10. Stop Conditions

Stop and report instead of continuing when any of these are true:

- current branch does not match the lane manifest
- current cwd does not match `worktree_path`
- required edit falls outside `file_scope_lock`
- active file lock overlap is discovered
- singleton-only path is required without an approved serialized plan
- lane worktree is missing or not registered with git
- verification fails for a reason that is not clearly tied to the lane change
- credentials are needed but the worktree env helper cannot link them
- main checkout has uncommitted changes that would be affected by closeout

A bounded stop preserves lane truth better than an unrecorded workaround.

---

## 11. Command Reference

Start or resume a lane:

```bash
pnpm ops:lane-start -- <UTV2-###> --tier <T1|T2|T3> --branch <branch> --lane-type <type> --executor <executor> --files <path-or-glob>
```

Verify lane cwd and branch:

```bash
pwd
git branch --show-current
git status --short --branch
```

Link approved credentials into a worktree:

```bash
npx tsx scripts/link-worktree-env.ts <worktree-path>
```

Finalize after merge from main checkout:

```bash
pnpm ops:lane-finalize -- --issue <UTV2-###> --pr <PR-number-or-url> --json
```

Reconcile current orchestration state from main checkout:

```bash
pnpm ops:orchestration-reconcile --current --json
```

---

## 12. Related Authorities

- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy and lane lifecycle
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest schema, file locks, heartbeat semantics
- `docs/05_operations/execution-location-policy.md` — main checkout vs worktree routing
- `docs/05_operations/WORKTREE_ISOLATION_POLICY.md` — worktree isolation and install/build state
- `docs/governance/LANE_CONCURRENCY_POLICY.md` — active lane limits and conflict handling
