# Manifest Housekeeping Policy

**Status:** Ratified  
**Effective:** 2026-05-15 (UTV2-970 / UTV2-961)  
**Supersedes:** ad-hoc `[skip ci]` practices prior to 2026-05-15

---

## Problem this policy solves

Before UTV2-961/UTV2-970, lane governance used `[skip ci]` on manifest housekeeping commits to avoid expensive CI. When those commits landed at the HEAD of a PR branch, required branch-protection checks never ran. The branch was stuck — it could not satisfy G4 without an admin merge, which in turn disrupted post-merge automation.

The chain reaction:

```
[skip ci] commit at HEAD
  → required checks do not run
  → G4 cannot be satisfied normally
  → admin merge required
  → post-merge automation may not fire
  → lane closeout/reset becomes manual
```

---

## Policy: when manifest housekeeping occurs

### Pre-merge (on the lane branch)

| Commit | Has [skip ci]? | Required? |
|--------|---------------|-----------|
| `chore(lanes): UTV2-NNN lane manifest and sync metadata` | **NO** | Yes — written by dispatch at lane-open |
| Implementation commits | **NO** | Yes — the actual work |
| PR-open manifest update (commit_sha, pr_url) | **NO** — use `[skip ci]` only on main, never on feature branches | Optional |

**Rule: no `[skip ci]` commit may be the last commit on a PR branch.**

Feature branch housekeeping commits are either:
1. The lane-open manifest commit (no `[skip ci]`) — always followed by implementation commits
2. The PR-open manifest update — if added to the branch, must not be the HEAD commit when CI gates run (add after PR is open or use `[skip ci]` only on the separate manifest-update commit to main via `ops:lane:close`)

### Post-merge (on main, by automation)

| Commit | Has [skip ci]? | Source |
|--------|---------------|--------|
| `chore(lanes): close UTV2-NNN — lane closed, sync file removed` | **NO** (as of UTV2-961) | `post-merge-lane-close.yml` |

**Rule: `post-merge-lane-close.yml` uses actor guard (`github.actor != 'github-actions[bot]'`) to prevent push loops instead of `[skip ci]`.**

---

## Sync file model (per-issue, not shared)

Each lane writes `.ops/sync/UTV2-NNN.yml` at lane-open. This file:
- Is created by `scripts/ops/lane-start.ts` or the dispatch skill
- Contains only that lane's issue ID
- Is deleted by `post-merge-lane-close.yml` after the lane closes

**The shared `.ops/sync.yml` stays permanently neutral (`issues: []`) on main.** No branch ever mutates it. This eliminates the guaranteed rebase conflict that all concurrent lanes previously experienced.

---

## Lightweight CI for housekeeping-only changes

`.github/workflows/housekeeping-fast-ci.yml` provides a fast required-check path for PRs that touch only governance files (manifests, sync files, docs). It:

- Validates that all `docs/06_status/lanes/UTV2-*.json` files have valid structure
- Validates that all `.ops/sync/UTV2-*.yml` files reference their expected issue ID
- Runs on `push` to main and `pull_request` targeting main
- Completes in seconds — no pnpm install, no build, no test

For a manifest-only PR, `housekeeping-fast-ci.yml` satisfies the required check gate. The `merge-gate.yml` T3 auto-pass covers the tier gate.

---

## Regression proof

PR #681 (UTV2-961, merged 2026-05-15) is the regression proof:
- Branch `claude/utv2-961-fix-merge-friction` opened with a lane-manifest commit (no `[skip ci]`)
- Implementation commits followed
- PR merged without admin override — G4 passed normally via T2 path
- Post-merge automation fired and closed the lane without `[skip ci]` on main

No `[skip ci]` appeared at branch HEAD at any point during this lane's lifecycle.

---

## Rules summary

1. **Never use `[skip ci]` on a commit that will be the HEAD of a PR branch.** Period.
2. **Lane-open commits do not use `[skip ci]`.** The manifest + sync file commit is the first commit on every lane branch and is followed by implementation work.
3. **Post-merge housekeeping uses actor guard, not `[skip ci]`.** The `github-actions[bot]` actor guard prevents push loops without suppressing CI for other pushes.
4. **Per-issue sync files replace shared sync.yml mutation.** Concurrent branches never conflict on `.ops/sync.yml`.
5. **If a manifest-only PR exists, label it `tier:T3`.** `merge-gate.yml` auto-passes T3, satisfying G4 without `[skip ci]`.

---

## Canonical references

- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest lifecycle and schema
- `.github/workflows/post-merge-lane-close.yml` — post-merge automation (actor guard, no `[skip ci]`)
- `.github/workflows/housekeeping-fast-ci.yml` — lightweight CI gate
- `.claude/commands/dispatch.md` — lane-open commit format (per-issue sync file)
- UTV2-961 — full merge-friction fix (per-issue sync, actor guard, workflow_dispatch)
- UTV2-970 — this policy document
