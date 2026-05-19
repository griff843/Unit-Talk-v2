# Worktree Isolation Policy

**Status:** Ratified  
**Authority:** PM + Orchestrator  
**Effective:** 2026-05-14  
**Supersedes:** ad-hoc worktree decisions in session memory

---

## Problem

The monorepo uses pnpm workspaces with project references. When a git worktree is created at `.worktrees/<branch>/`, the setup script (`scripts/ops/worktree-setup.ps1`) creates **junctions** (Windows symlinks) for `node_modules` from the main checkout. This works for app-only changes but **breaks** when a lane modifies `packages/*` because:

1. pnpm hoists workspace package binaries into root `node_modules`
2. Junction-linked `node_modules` reflects the state of the main checkout, not the branch
3. TypeScript project references (`tsc --build`) resolve package source from the junction — picking up the wrong version mid-edit
4. `pnpm verify` in the worktree can pass while the same command fails on the branch after rebase

**Incident:** UTV2-915 (2026-05-12) — Codex lane modified `packages/promotion-service` inside a worktree. Tests passed in the worktree, failed on main after merge. Root cause: junction picked up stale compiled output from main checkout's `dist/`.

---

## Policy

### Rule 1 — Package lanes always run on main checkout

Any lane whose `file_scope_lock` includes any path matching `packages/**` **must** execute on the main working tree, not a worktree.

```
Codex / Claude execute on: main checkout (C:\Dev\Unit-Talk-v2-main)
Branch isolation via: git branch + standard checkout, NOT git worktree
```

No exceptions. If a T2 lane touches both `apps/**` and `packages/**`, it falls under this rule.

### Rule 2 — App-only lanes may use worktrees

A lane whose `file_scope_lock` is entirely within one of:
- `apps/command-center/**`
- `apps/discord-bot/**`
- `apps/smart-form/**`
- `apps/qa-agent/**`
- `scripts/**`
- `docs/**`
- `.claude/**`
- `.github/**`

…may use a worktree. These apps do not have inter-package compiled dependencies that the junction approach breaks.

**Excluded from worktree eligibility** (even though they're in `apps/`):
- `apps/api/**` — imports from `packages/db`, `packages/contracts`, `packages/domain`
- `apps/worker/**` — imports from `packages/db`, `packages/contracts`
- `apps/ingestor/**` — imports from `packages/db`

### Rule 3 — Linux lanes: default to worktrees

On Linux, parallel Codex and Claude lanes default to dedicated git worktrees. The main checkout is reserved for control, reconciliation, branch refresh, merge, Linear Done, and lane closeout operations.

Each lane worktree must have isolated install/build state. Do not junction, symlink, or otherwise share `node_modules` from the main checkout into a lane worktree.

**Exception:** sensitive singleton work still executes under the merge/control discipline when the lane touches Tier C paths, migrations, lifecycle authority, or another path class explicitly marked singleton by governance.

---

## Enforcement

### In `/dispatch` (Phase 3 — Start lanes)

Before creating a worktree, evaluate the file scope:

```typescript
const usesWorktree = (fileScope: string[]): boolean => {
  const packageTouching = fileScope.some(f =>
    f.startsWith('packages/') ||
    f.startsWith('apps/api/') ||
    f.startsWith('apps/worker/') ||
    f.startsWith('apps/ingestor/')
  );
  return !packageTouching;  // worktree only if nothing package-adjacent
};
```

If `usesWorktree` returns false: do not start the lane in parallel. Route it through the serialized control/merge flow or require PM/orchestrator approval for the singleton execution plan.

### In lane manifest

The `worktree_path` field must identify the lane execution directory for worktree-backed lanes:

```json
{
  "worktree_path": ".out/worktrees/codex__utv2-###-slug",
  "branch": "codex/utv2-###-slug"
}
```

Setting `worktree_path` to `"."` is reserved for the main checkout control/merge flow or a specifically approved singleton lane. It is invalid for normal parallel implementation lanes.

### In `AGENTS.md`

Codex is instructed to execute lane work from the dedicated worktree path reported by `/dispatch` / `ops:lane-start`. The main checkout is not a parallel lane execution cwd.

---

## Future fix path

When the worktree setup is improved, the correct approach is:

```bash
# Instead of junction (current — broken for packages):
# cmd /c mklink /J .worktrees/<branch>/node_modules <root>/node_modules

# Correct approach (copy root pnpm store symlinks, not junction):
pnpm install --frozen-lockfile  # inside the worktree
```

This requires the worktree to have its own full `pnpm install`. Estimated cost: 60–90 seconds per worktree creation. This cost is acceptable when the board is executing lanes in parallel because it prevents cross-lane dependency and build-state contamination.

Track fix under a future UTV2 issue if throughput analysis shows worktree isolation is blocking parallel execution.

---

## Summary table

| Lane type | File scope | Execution location |
|---|---|---|
| Normal parallel lane | disjoint file scope | Dedicated worktree |
| Touches `packages/**` | any | Worktree allowed only with isolated install/build state; serialize if ownership risk is high |
| Touches `apps/api/` or `apps/worker/` | any | Worktree allowed only with isolated install/build state; serialize if runtime risk is high |
| App-only UI/docs | `apps/command-center/`, `docs/`, `scripts/`, `.claude/`, `.github/` | Dedicated worktree |
| Merge/control | branch refresh, merge, Linear Done, lane closeout | Main checkout (`worktree_path: "."`) |
| Tier C / migration / singleton runtime | sensitive paths | Serialized execution plan; PM/orchestrator approval required |

---

## Related

- `CLAUDE.md` — lane execution expectations  
- `.claude/commands/dispatch.md` — Phase 3 lane start logic  
- `scripts/ops/worktree-setup.ps1` — current junction approach (known broken for packages)  
- Memory: "Worktree broken for package lanes" (2026-05-12)
