# UTV2-1472 Diff Summary

## Change

Updates the dispatch skill files so Claude implementation lanes run as background subagents in their own dedicated worktrees — the same pattern already used for Codex lanes — instead of executing sequentially, synchronously, in the orchestrator's own session.

## Files changed

- `.claude/commands/dispatch.md` — Phase 4 "Claude lanes" section now dispatches implementation via `Agent({run_in_background: true, ...})` into the worktree `ops:lane-start` already created, instead of "execute the work directly in this conversation." Phase 5 renamed to "Concurrent execution for multiple lanes"; both Claude and Codex lanes now follow the identical dispatch → background execution → completion notification → review → merge/close cycle.
- `.claude/commands/dispatch-board.md` — Phase 3 no longer treats "Claude is single-threaded" as a reason to serialize; Phase 5's "Claude lanes (you are the executor)" section is rewritten as a shared monitor → verify → close cycle for both executors, triggered by background-agent completion notifications rather than synchronous in-session execution.
- `.claude/commands/lane-management.md` — adds a "Concurrent lanes" section stating multiple Claude and/or Codex lanes may be active at once (within `CONCURRENCY_CONFIG.json` limits), Claude is not single-threaded, and merge/close remain serialized through the merge mutex regardless of executor.

## Guardrails preserved (unchanged by this diff)

- **Merge mutex still serializes merge/close.** Every merge/close step in both skill files still routes through `pnpm ops:merge-wrapper` and `pnpm ops:merge-lock acquire` before `pnpm ops:lane-close`. This diff makes *execution* concurrent; it does not touch the merge/close serialization already enforced by the merge mutex.
- **One lane = one worktree = one agent.** Each background `Agent` call operates in the single worktree `ops:lane-start` created for that lane — it does not create an additional nested worktree and does not touch the main checkout.
- **Orchestrator never edits lane implementation files.** The background-agent prompt in `/dispatch` Phase 4 explicitly instructs the agent to do the implementation, run `pnpm verify`/R-level/test:db, commit, push, and open the PR — the orchestrator's role is dispatch + monitor + review + merge + close, never direct edits to lane code.
- **File-scope-lock disjointness is still required before dispatching a second lane** (Phase 3's parallel dispatch guard in `dispatch-board.md`, already unconditional — this diff does not weaken it).

## Bootstrap note

This lane's own skill-file edits (the content described above) were written directly by the orchestrator rather than via the pattern it describes, because the background-agent execution mechanism did not exist yet at the time this lane started — there was no prior mechanism to bootstrap through. See `verification.md`'s "Demonstration" section for the acceptance-criteria proof, which *does* use the newly-implemented pattern (two genuinely separate background agents with overlapping execution windows) once the mechanism was in place.

## Merge order

Standalone. No dependency on any other open lane. Related to UTV2-1533 (concurrency ramp) only in that UTV2-1533 raises the numeric caps this mechanism will use — this lane does not depend on UTV2-1533 merging first.
