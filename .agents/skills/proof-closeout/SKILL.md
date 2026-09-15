---
name: proof-closeout
description: Run Unit Talk proof and closeout workflows efficiently. Use when verifying implementation, preparing closeout evidence, checking runtime health, or building a compact proof bundle for a task.
category: verification
owner: codex
trigger: Verifying implementation, preparing closeout evidence, checking runtime health, or building proof bundles.
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
pnpm proof:t1 -- --issue <WORK-ID> --change "<summary>" --pick <pick-id>
```
3. Drill down only if needed:
```bash
pnpm verify:pick -- <pick-id>
pnpm pipeline:health
pnpm github:checks -- <pr>
```

## Rules

- prefer compact CLI proof over raw dumps
- preserve exact-head proof, independent review and tier-specific merge approvals; optional tracker errors cannot block verified repository closeout
- legacy UTV2/UNI identities remain valid; no tracker migration or administrative restart is required
- do not claim VERIFIED without running the relevant command
- separate proof from fixes; prove first, then repair if needed

## Reference

- [`.claude/commands/t1-proof.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/t1-proof.md)
- [`.claude/commands/verify-pick.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/verify-pick.md)
- Closing a lane: `ops:lane-close <WORK-ID>` (wraps `ops:truth-check`); see `.claude/commands/lane-management.md`

Repository closeout records explicit completion intent with `ops:lane-close <ID> --complete-work` after merge/proof verification. Tracker transition is opt-in via `--sync-tracker`; default closeout performs no tracker request, including for legacy identities with configured credentials. Neither flag bypasses proof, required checks, or approval.
