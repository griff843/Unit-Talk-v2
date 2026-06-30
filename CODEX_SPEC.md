# Codex Spec: UTV2-965 — Define execution-location policy and routing

## Issue
UTV2-965: Define machine-readable execution-location routing for lanes without assuming every lane uses a git worktree.

## Branch
`codex/utv2-965-define-execution-location-policy-and-routing`

## Tier
T2

## Context
UTV2-962 (canonical registry reconciliation) is Done and merged — that is the root dependency for this issue. The repo already has `docs/05_operations/WORKTREE_ISOLATION_POLICY.md`. This issue must align with it, not replace it. The known failure mode this addresses: a 2026-05-12 incident where a lane touching `packages/` was dispatched into a git worktree, causing junction/symlink breakage. The policy must make this unroutable by inspection before dispatch.

## Scope — write only these files

- `docs/05_operations/execution-location-policy.md` (NEW — primary deliverable)
- May reference `docs/05_operations/WORKTREE_ISOLATION_POLICY.md` but do NOT modify it

Do NOT touch any files under `packages/`, `apps/`, `supabase/`, `.claude/hooks/`, or `scripts/`.

## Deliverables

1. **Execution-location decision model** — document the two states: `main_checkout` and `worktree`
2. **Eligibility rules** (machine-readable) — which lane types go where:
   - `packages/**` → `main_checkout` always
   - `apps/api/**`, `apps/worker/**`, `apps/ingestor/**` → `main_checkout` (package-adjacent)
   - `apps/command-center/**`, `apps/discord-bot/**`, `apps/smart-form/**`, `apps/qa-agent/**` → `worktree` eligible
   - `docs/**`, `scripts/**`, `.claude/**`, `.github/**` → `worktree` eligible
   - All Codex lanes → `main_checkout` always, regardless of file scope
3. **Registry field definitions** — document `execution_location` and `worktree_path` fields for lane manifests
4. **Validation rules** — what checks must pass before a lane can use a worktree (e.g. no `packages/` in file_scope_lock)
5. **Migration note** — what existing lane-start behavior conflicts with this policy and how to resolve it

## Required model

The document must define execution location explicitly:
```
execution_location: main_checkout  — when lane touches packages/* or package-adjacent apps
execution_location: worktree       — when lane is app/docs/scripts only AND executor is Claude
worktree_path: "."                 — always set when execution_location is main_checkout
```

## Acceptance criteria
- Execution-location rules are explicit and machine-readable
- Lane-start/dispatch behavior has a clear target contract
- Invalid worktree routing can be detected before execution by inspecting file_scope_lock
- Existing repo policy in WORKTREE_ISOLATION_POLICY.md is preserved and referenced, not duplicated

## Pre-PR steps (required before opening PR)
1. `pnpm verify` — must exit 0
2. `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — paste output in PR body under `## R-level compliance`
3. Open PR: `gh pr create --title "docs(governance): UTV2-965 execution-location policy and routing"`
4. PR body must include: `Closes UTV2-965`, `## R-level compliance` section, `## Merge order` section
5. After PR opens: `gh pr edit <PR-number> --add-label "tier:T2"`

## Merge order (for PR body)

| Lane | Issue | Files touched | Must merge after |
|---|---|---|---|
| Codex | UTV2-965 | `docs/05_operations/execution-location-policy.md` | none (independent of UTV2-963, UTV2-966) |

## Do NOT
- Modify `docs/05_operations/WORKTREE_ISOLATION_POLICY.md`
- Touch any file under `packages/`, `apps/`, `supabase/`, `scripts/`, `.claude/`
- Create a second source of lane truth (agents read from `.claude/lanes.json`, not this doc)
- Add runtime enforcement code — this issue is policy/docs only
