---
name: proof-closeout
description: Run Unit Talk proof and closeout workflows efficiently. Use when verifying implementation, preparing closeout evidence, checking runtime health, or building a compact proof bundle for a task.
---

# Proof Closeout

Use this when the task needs verification, proof, or closeout evidence.

## Default flow

1. Start with:
```bash
pnpm ops:brief
```
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
- [`.claude/commands/sprint-close.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/sprint-close.md)
