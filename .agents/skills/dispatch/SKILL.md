---
name: dispatch
description: Run Unit Talk's Codex-native dispatch workflow. Use when the user asks for /dispatch, queue dispatch, Codex lane dispatch, or one-command issue execution from Linear into a lane.
---

# Dispatch

Use this when the user asks for `/dispatch`, wants a Linear issue moved into an execution lane, or wants to inspect what Codex can take from the queue.

This is the Codex version of Claude's `/dispatch` command. It uses the existing repo scripts instead of Claude slash-command state.

## First Checks

1. Load repo truth:
```bash
pnpm ops:brief
```
2. Inspect active Codex lanes:
```bash
pnpm codex:status
```
3. For queue selection or Linear-derived scope, inspect:
```bash
pnpm codex:classify
```

If `pnpm ops:brief` fails, report the failure and continue only for local skill/script edits that do not need queue truth.

## Dry Run

For any specific issue, validate before starting a lane:
```bash
pnpm codex:dispatch -- --issue UTV2-### --tier T2 --branch codex/utv2-###-slug --files <path> --dry-run
```

Use repeatable `--files` flags. Do not use the removed `--allowed` flag.

## Dispatch

When prerequisites are clear and file scope is explicit:
```bash
pnpm codex:dispatch -- --issue UTV2-### --tier T2 --branch codex/utv2-###-slug --files <path>
```

The command:
- validates the issue and branch
- runs `ops:preflight`
- creates the lane manifest via `ops:lane-start`
- writes the Codex task packet to `.claude/codex-queue/UTV2-###.md`

After dispatch, read and follow the generated packet before implementing:
```bash
Get-Content .claude\codex-queue\UTV2-###.md
```

## Receive Returned Work

When a Codex lane returns with a branch and PR:
```bash
pnpm codex:receive -- --issue UTV2-### --branch <branch> --pr <github-pr-url>
```

This links the PR to the lane manifest and moves the lane to review. It does not replace verification.

## Codex Return Validation

Before accepting any Codex return, run this checklist in order:

- [ ] **sync.yml issue matches branch** — `.ops/sync.yml` entities.issues[0] must equal the branch's `UTV2-###`. Run `pnpm ops:sync-check` or inspect manually. If mismatched, correct the file before committing.
- [ ] **test:ops completeness** — `package.json` `test:ops` must include all test files added or renamed by the Codex PR. Compare against prior `main` state. Codex sometimes replaces rather than appends; restore any dropped entries.
- [ ] **No orphaned untracked files** — Run `git status` in the worktree. Untracked files that aren't intentional artifacts (e.g., `.md` docs committed by Codex) must be deleted or committed. Files that conflict with other active lanes must not be present.
- [ ] **pnpm verify passes** — Run `pnpm verify` from repo root on the Codex branch before committing or pushing. If verify fails, fix the Codex output before merging.

If the Codex branch is behind `main`, create a v2 branch (`claude/utv2-###-v2` or `codex/utv2-###-v2`), cherry-pick the Codex commits, resolve any conflicts (`.ops/sync.yml` and `package.json` are the most common), then push the v2 branch.

## Routing Rules

- Never dispatch T1 without explicit PM/user confirmation.
- T2 is Codex-safe only when acceptance criteria and file scope are explicit.
- Route migration, contract, domain lifecycle, promotion, settlement, outbox, worker, schema, or ambiguous work to Claude/human planning first.
- Never start a lane whose file scope overlaps an active lane.
- Keep max active Codex lanes to 2 unless the user explicitly approves more.
- Fail closed when tier, scope, acceptance criteria, branch, or lane truth is unclear.

## Verification

After implementation, run the narrow tests first, then the required gate:
```bash
pnpm verify
```

For DB-layer changes, also run:
```bash
pnpm test:db
```

## References

- [Claude dispatch command](C:/Dev/Unit-Talk-v2-main/.claude/commands/dispatch.md)
- [Codex dispatch script](C:/Dev/Unit-Talk-v2-main/scripts/codex-dispatch.ts)
- [Codex receive script](C:/Dev/Unit-Talk-v2-main/scripts/codex-receive.ts)
- [Codex status script](C:/Dev/Unit-Talk-v2-main/scripts/codex-status.ts)
