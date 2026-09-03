---
name: proof-closeout
description: LEGACY. Correcting a proof bundle that ALREADY EXISTS under docs/06_status/proof/ so it passes the proof gates. Not for ordinary verification — ordinary work carries its evidence in the PR body (docs/mission/intent.md, AGENTS.md PR template) and needs no bundle, no lane and no ticket.
category: verification
owner: codex
trigger: A proof bundle already exists under docs/06_status/proof/ and a proof gate is red against it, or its SHA binding is stale.
---

# Proof Closeout (legacy)

**Selection rule:** this skill applies only when `docs/06_status/proof/<BUNDLE>/` already exists.
If you are verifying ordinary work, you are in the wrong place — see *Ordinary verification* below
and stop reading here. Selecting this skill for ordinary work reintroduces the ticket-and-lane
workflow that mission-native packets deliberately do not have.

## Ordinary verification (the common case)

No bundle, no lane, no ticket. Run the checks and put the result in the PR body:

```bash
pnpm verify
```

Record in the PR body, per the template in `AGENTS.md`: what you ran, the exact output, what is
proven, and what is not. `/verification` covers what must be green before a merge claim.

## Legacy: repairing an existing bundle

Only from here down does any of this apply, and only to a bundle already on disk.

Both tools below are keyed by a legacy `UTV2-###` issue ID — `ops:proof-check` takes it as its
first positional and `ops:proof-rebind` requires `--issue`. That is not an oversight to route
around: it is what makes them legacy. Work with no ticket has no bundle for them to operate on.

1. Identify the bundle and the gate that is red:

```bash
ls docs/06_status/proof/
pnpm ops:proof-check <UTV2-###> --pr <PR_NUMBER> --json
```

2. Rebind a stale SHA (the usual cause). It previews by default; `--apply` writes:

```bash
pnpm ops:proof-rebind --issue <UTV2-###> --merge-sha <sha> --approved-head <sha> --pr <PR_NUMBER>
pnpm ops:proof-rebind --issue <UTV2-###> --merge-sha <sha> --approved-head <sha> --pr <PR_NUMBER> --apply
```

   Do not pass `--pr-url`; it is refused on purpose, because the canonical URL is derived from the
   validated PR record rather than taken from the caller.

3. Re-run step 1 before pushing. A bundle is correct only when the checker says so, not when it
   reads correct.

## Rules

- Prefer compact CLI proof over raw dumps.
- Do not claim VERIFIED without running the relevant command.
- Separate proof from fixes: prove first, then repair.
- Do not create a new proof bundle for ordinary work. If no bundle exists, none is needed.

## Reference

- [`.claude/commands/verification.md`](../../../.claude/commands/verification.md) — ordinary verification
- [`.claude/commands/proof-authoring.md`](../../../.claude/commands/proof-authoring.md) — bundle correctness
- [`.claude/commands/verify-pick.md`](../../../.claude/commands/verify-pick.md) — single-pick runtime check
- Historical lane closeout lives under `/legacy:*`; it is not part of mission-native execution.
