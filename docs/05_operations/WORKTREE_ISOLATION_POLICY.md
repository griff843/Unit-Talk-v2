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

### Rule 3 — Codex lanes: default to main checkout

Until the worktree setup script is rewritten to copy (not junction) `node_modules`, all Codex lanes default to running on the main checkout regardless of file scope. The overhead of a full `pnpm install` in a worktree exceeds the isolation benefit for the current throughput.

**Exception:** Codex lanes that are pure docs/scripts (`docs/**`, `scripts/**`) may use a worktree at orchestrator discretion.

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

If `usesWorktree` returns false: check out a branch on main, do **not** call `git worktree add`.

### In lane manifest

The `worktree_path` field must be set to `"."` (main checkout) for all package-touching lanes:

```json
{
  "worktree_path": ".",
  "branch": "codex/utv2-###-slug"
}
```

Setting `worktree_path` to anything other than `"."` on a package-touching lane is a manifest validation error.

### In `AGENTS.md`

Codex is instructed not to expect a separate worktree directory. The branch is checked out on the main working tree.

---

## Future fix path

When the worktree setup is improved, the correct approach is:

```bash
# Instead of junction (current — broken for packages):
# cmd /c mklink /J .worktrees/<branch>/node_modules <root>/node_modules

# Correct approach (copy root pnpm store symlinks, not junction):
pnpm install --frozen-lockfile  # inside the worktree
```

This requires the worktree to have its own full `pnpm install`. Estimated cost: 60–90 seconds per worktree creation. Acceptable for T1 isolation; not justified for routine T2/T3 Codex lanes.

Track fix under a future UTV2 issue if throughput analysis shows worktree isolation is blocking parallel execution.

---

## Summary table

| Lane type | File scope | Execution location |
|---|---|---|
| Touches `packages/**` | any | Main checkout (`worktree_path: "."`) |
| Touches `apps/api/` or `apps/worker/` | any | Main checkout |
| App-only UI/docs | `apps/command-center/`, `docs/`, `scripts/`, `.claude/`, `.github/` | Worktree allowed |
| Codex (any) | any | Main checkout (default until fix) |
| Claude T1 | sensitive paths | Main checkout (Tier C requires orchestrator direct) |

---

## Related

- `CLAUDE.md` — lane execution expectations  
- `.claude/commands/dispatch.md` — Phase 3 lane start logic  
- `scripts/ops/worktree-setup.ps1` — current junction approach (known broken for packages)  
- Memory: "Worktree broken for package lanes" (2026-05-12)
