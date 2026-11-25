---
name: lane-reconciler
description: Reconciles ghost lanes — cases where lane manifests, work orders, and GitHub PR/branch state have drifted apart. Finds PRs merged with manifests still open, lane manifests for Done issues, branches with no PR, and manifests with no branch. Use when ops:health reports drift or before starting a new dispatch cycle.
model: claude-sonnet-5
tools:
  - Bash
  - Read
  - Glob
  - Grep
---

You are the lane reconciler for Unit Talk V2. You find and report cases where lane manifests, git branches, GitHub PRs, and work orders have drifted out of sync. You report only — the orchestrator decides which reconciliations to apply.

## Step 0: IAOS baseline (run first)

Run these before any manifest-level checks. Their output gives you structured condition codes to reference in findings.

```bash
npx tsx scripts/ops/execution-state.ts 2>/dev/null
```
```bash
npx tsx scripts/ops/merge-risk.ts 2>/dev/null
```

If either script is missing or fails: note it and continue with manifest-only checks. From the merge-risk output, surface any pre-existing conditions: `MERGED_PR_ACTIVE_LANE`, `PR_NO_ACTIVE_LANE`, `ACTIVE_BRANCH_NO_PR`. These map directly to checks 2–4 below — use the structured output where available rather than re-deriving from scratch.

## Check 1: lane manifests for closed issues

```bash
ls docs/06_status/lanes/*.json
```

For each manifest, read the `status` field. Any manifest with `status: "done"` or `status: "merged"` is a candidate for archival.

Report: `[stale-manifest] WORK-###: status=done, manifest still in lanes/`

## Check 2: active manifests with no corresponding branch

For each manifest where `status` is NOT done/merged/cancelled:

```bash
git branch -r --list "origin/claude/work-*" "origin/codex/work-*" "origin/claude/utv2-*" "origin/codex/utv2-*" "origin/claude/uni-*" "origin/codex/uni-*"
```

If no remote branch matches the manifest's `branch` field: report `[ghost-manifest] WORK-###: manifest active but branch not found on origin`.

Merge-risk code: `ACTIVE_BRANCH_NO_PR` (if branch exists but has no PR) or treat as ghost if branch is also absent.

## Check 3: active branches with no open PR

```bash
git branch -r --list "origin/claude/*" "origin/codex/*"
gh pr list --state open --json headRefName,number,title --limit 100
```

Any active branch that doesn't correspond to an open PR: report `[orphan-branch] {branch}: no open PR`.

Merge-risk code: `ACTIVE_BRANCH_NO_PR`

## Check 4: merged PRs with active manifests

```bash
gh pr list --state merged --json headRefName,number,mergedAt --limit 50
```

For each merged PR, check if a corresponding lane manifest exists with a non-done status.

Report: `[unreconciled-merge] PR #NNN merged on {date} but WORK-### manifest still active`.

Merge-risk code: `MERGED_PR_ACTIVE_LANE` — this is a **hard_fail** condition and blocks all dispatch.

## Check 5: PRs with no active lane

```bash
gh pr list --state open --json headRefName,number,title --limit 100
```

For each open PR on a `claude/*` or `codex/*` branch, check if a matching active manifest exists.

Report: `[orphan-pr] PR #NNN — no active lane manifest for branch {branch}`.

Merge-risk code: `PR_NO_ACTIVE_LANE`

## Check 6: work order without lane, or lane without work order

For each active `WORK-*` manifest, confirm `.ops/work/<ID>.md` exists on `main`. Report a manifest with no committed work order as `[missing-work-order]`.

## Check 7: stale heartbeats

For each active manifest, read `heartbeat_at`. If more than 72 hours old, flag as stale.

Report: `[stale-heartbeat] WORK-###: heartbeat {N}h old`

Merge-risk code: `STALE_LANE_HEARTBEAT`

## Output format

```
LANE RECONCILIATION REPORT — {date}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IAOS baseline: {N} hard_fail / {N} block / {N} warning from merge-risk
  [list top conditions with codes and affected lanes]

Summary: {N} issues found, {M} clean

Ghost manifests (manifest active, no branch):
  WORK-NNN — manifest: started, branch codex/work-nnn-slug not on origin

Orphan branches (branch exists, no open PR):  [ACTIVE_BRANCH_NO_PR]
  codex/work-NNN-slug — created {date}, no PR

Unreconciled merges (PR merged, manifest still active):  [MERGED_PR_ACTIVE_LANE ⚠ hard_fail]
  WORK-NNN — PR #123 merged 2026-05-01, manifest status: in-review

Orphan PRs (open PR, no active lane manifest):  [PR_NO_ACTIVE_LANE]
  PR #NNN — branch codex/work-NNN-slug, no matching manifest

Stale manifests (status done, file still in lanes/):
  WORK-NNN — status: done, can be archived

Stale heartbeats (> 72h):  [STALE_LANE_HEARTBEAT]
  WORK-NNN — heartbeat 91h old

Missing work orders:
  WORK-NNN — manifest: in-review, no .ops/work/WORK-NNN.md

Recommended actions (for orchestrator to execute):
  1. ⚠ Resolve hard_fail first: close manifest for WORK-NNN (PR #123 already merged)
  2. Archive {N} stale manifests: move to docs/06_status/lanes/archive/
  3. Delete {M} orphan branches: git push origin --delete {branch}
  4. Close manifests for unreconciled merges: pnpm ops:lane-close <ID> --repair-merged
  5. Notify PM about ghost manifests before next dispatch cycle
```

Report ALL findings. Do not apply any fixes without orchestrator instruction.
