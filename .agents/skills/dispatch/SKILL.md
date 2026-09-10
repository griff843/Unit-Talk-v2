---
name: dispatch
description: Run Unit Talk's Codex-native dispatch workflow. Use when the user asks for /dispatch, queue dispatch, Codex lane dispatch, or one-command local work execution into a lane.
category: governance
owner: codex
trigger: User asks for /dispatch, queue dispatch, Codex lane dispatch, or one-command local work execution.
---

# Dispatch

Use this when the user asks for `/dispatch`, wants local work moved into an execution lane, or wants to inspect what Codex can take from the queue.

This is the Codex version of Claude's `/dispatch` command. It uses the existing repo scripts instead of Claude slash-command state.

## Explicit repository work

For an assigned `WORK-<number>` task, follow `.claude/commands/dispatch.md` →
“Repository-owned WORK tasks”. Read the mission and local `.ops/work/<ID>.md`
contract, declare tier and lane type, use issue-scoped reconciliation, and dispatch
through `codex:dispatch`/`ops:lane-start`. Repository scope is primary for every namespace, even when a tracker token is configured. Optional mirroring is not an admission prerequisite. Preserve all admission,
scope, tier-floor, verification, review, merge-mutex and reserved-approval controls.

## First Checks

1. Load repo truth:
```bash
pnpm ops:brief
```
2. Inspect active Codex lanes:
```bash
pnpm codex:status
```
3. Inspect `.ops/work/*.md`, mission priorities, current PRs and `pnpm ops:execution-state`. Do not run tracker queue selection for ordinary work.

If `pnpm ops:brief` fails, identify the failed source. Unavailable optional tracker data is non-blocking; required local substrate or verification failures still refuse.

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
- creates or resumes the git worktree and lane manifest via `ops:lane-start`
- records `worktree_path`, dependency setup state, and cwd guard instructions in the manifest/packet
- writes the Codex task packet to `.claude/codex-queue/UTV2-###.md`

After dispatch, read and follow the generated packet before implementing:
```bash
Get-Content .claude\codex-queue\UTV2-###.md
```

Run lane work from the packet worktree cwd. The main checkout is control and merge only; do not branch-switch it for executable lane work.

## Receive Returned Work

When a Codex lane returns with a branch and PR:
```bash
pnpm codex:receive -- --issue UTV2-### --branch <branch> --pr <github-pr-url>
```

This links the PR to the lane manifest and moves the lane to review. It does not replace verification.

## Post-Merge Closeout

After the PR merges, serialize closeout through the merge mutex and run:
```bash
pnpm ops:lane-finalize -- --issue UTV2-### --pr <github-pr-url-or-number> --json
pnpm ops:orchestration-reconcile --current --cleanup-plan --json
```

The finalize command records the merge SHA, generates eligible T2 proof, closes the lane, releases the lease, and runs current-state reconcile. Cleanup remains dry-run unless an operator deliberately applies the listed local cleanup commands.

## Codex Return Validation

Before accepting any Codex return, run this checklist in order:

- [ ] **sync.yml issue matches branch** — `.ops/sync.yml` entities.issues[0] must equal the branch's `UTV2-###`. Run `pnpm ops:sync-check` or inspect manually. If mismatched, correct the file before committing.
- [ ] **test:ops completeness** — `package.json` `test:ops` must include all test files added or renamed by the Codex PR. Compare against prior `main` state. Codex sometimes replaces rather than appends; restore any dropped entries.
- [ ] **No orphaned untracked files** — Run `git status` in the worktree. Untracked files that aren't intentional artifacts (e.g., `.md` docs committed by Codex) must be deleted or committed. Files that conflict with other active lanes must not be present.
- [ ] **pnpm verify passes** — Run `pnpm verify` from repo root on the Codex branch before committing or pushing. If verify fails, fix the Codex output before merging.

If the branch is behind `main`, use the sanctioned merge wrapper to refresh the existing PR branch and rebind proof to its new head. Do not replace an existing PR merely to migrate tracker identity.

## Routing Rules

- Never dispatch T1 without explicit PM/user confirmation.
- T2 is Codex-safe only when acceptance criteria and file scope are explicit.
- Route migration, contract, domain lifecycle, promotion, settlement, outbox, worker, schema, or ambiguous work to Claude/human planning first.
- Never start a lane whose file scope overlaps an active lane.
- Executor and total limits come only from the current concurrency config. Runtime, migration, modeling, and data-canonical lanes remain hard singletons. See `docs/governance/CONCURRENCY_CONFIG.json` and `docs/governance/LANE_CONCURRENCY_POLICY.md`.
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
