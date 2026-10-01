---
name: proof-closeout
description: Produce final governed evidence and close a lane. Use for proof bundles, runtime closeout evidence, or lane finalization; not ordinary edit-test loops.
category: verification
owner: codex
trigger: Preparing required proof artifacts, final runtime evidence, or lane/PR closeout.
---

# Proof Closeout

Use this when the task needs verification, proof, or closeout evidence.
Do not load it for ordinary focused tests during implementation; use it at the
final evidence or lane-closeout phase.

## Default flow

1. For static closeout, start with:
```bash
pnpm ops:brief -- --static
```
Use full `pnpm ops:brief` when the required proof includes runtime, database,
tracker, or PR truth.
2. For focused proof:
```bash
pnpm proof:t1 -- --issue <UTV2-ID> --change "<summary>" --pick <pick-id>
```
3. Drill down only if needed:
```bash
pnpm verify:pick -- <pick-id>
pnpm pipeline:health
pnpm github:checks -- <pr>
```

## Rules

- prefer compact CLI proof over raw dumps
- do not claim VERIFIED without running the relevant command
- separate proof from fixes; prove first, then repair if needed

## Reference

- [`.claude/commands/t1-proof.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/t1-proof.md)
- [`.claude/commands/verify-pick.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/verify-pick.md)
- Closing a lane: `ops:lane-close <UTV2-###>` (wraps `ops:truth-check`); see `.claude/commands/lane-management.md`
