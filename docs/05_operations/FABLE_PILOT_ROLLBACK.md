# Fable Pilot Rollback (UTV2-1569)

**Authority:** Claude/governance-owned. Changes require PM review.
**Produced by:** UTV2-1569, closing the gap the earlier pilot attempt (PR #1287,
unmerged) left open: its documented rollback ("revert this doc's Fable entry + the
corresponding `three-brain.md` row") had no mechanical backstop and did not cover the
model allowlists or contract validators it also touched.

---

## Why this document exists

A rollback that depends entirely on remembering to revert the right prose diffs is not
a rollback — it is a hope. This document describes the **two-part** rollback that
actually restores the pre-pilot Rule-9-only state, and proves (via
`scripts/ops/fable-pilot-rollback.test.ts`) that the mechanical part works even if the
documentary part is delayed or incomplete.

## Part 1 — Mechanical (run this first; it is sufficient on its own to stop all Fable routing)

```bash
npx tsx -e "
import { runFablePilotRollback } from './scripts/ops/fable-pilot-rollback.ts';
const result = runFablePilotRollback({
  reason: '<why this rollback is happening>',
  actor: '<your name>',
});
console.log(JSON.stringify(result, null, 2));
"
```

This flips two independent switches:

1. `docs/05_operations/policies/fable-pilot-policy.json`'s `pilot_enabled` → `false`.
2. `docs/05_operations/FABLE_PILOT_STATE.json`'s `status` → the terminal value
   `"rolled_back"`.

After this runs, `scripts/ops/planning-model-routing.ts`'s `resolvePlanningModel()` and
`resolveFableAdvisoryReview()` can **never** return `claude-fable-5` again, for any
trigger class, tier, or caller input — this is proven, not asserted, by
`scripts/ops/fable-pilot-rollback.test.ts`'s `"THE PROOF"` test, which activates a
fully-eligible pilot fixture, runs the rollback, and then asserts every one of the four
ratified trigger classes falls back to Sonnet on both the planning and advisory-review
paths.

`"rolled_back"` is a one-way terminal state: no function in
`scripts/ops/fable-pilot-state.ts` (including `activatePilot`) will ever transition a
rolled-back pilot back to `pending` or `active`. Restoring Fable eligibility after a
rollback requires a fresh state file and a fresh governance change — never a state
mutation of the rolled-back file.

The rollback function is idempotent — running it twice is safe; the second run reports
`NO-OP` for both switches.

## Part 2 — Documentary (source-level cleanliness; git-revert the following)

Part 1 makes Fable behaviorally unselectable immediately. Part 2 removes the pilot's
footprint from the source tree itself, so there is no dangling `claude-fable-5` string
anywhere once complete:

1. `.claude/commands/three-brain.md` — revert the "Fable 5 pilot routing" section back
   to the pre-pilot table (T1 planning subagent always Sonnet, no Fable row).
2. `docs/05_operations/OPERATING_MODEL_SONNET5.md` §1 — revert the Fable 5 entry back to
   "removed from active routing" (the exact pre-UTV2-1569 text is in git history at the
   commit immediately before this issue's first commit).
3. `docs/05_operations/agent-role-contracts.md` — remove `claude-fable-5` from the valid
   Claude model ID list (both the frontmatter-format comment and validation-rule bullet).
4. `docs/governance/AGENT_SKILL_CONTRACTS.md` — remove `'claude-fable-5'` from the
   `ClaudeModel` type union.
5. `scripts/ops/contract-validator.ts` — remove `'claude-fable-5'` from `VALID_MODELS`,
   and its paired test in `scripts/ops/contract-validator.test.ts` (the "claude-fable-5
   is valid" assertion, keeping the "unknown model" negative-path test).
6. `.claude/agents/fable-pilot-reviewer.md` — delete the agent file entirely (it
   declares `model: claude-fable-5`, which is no longer a valid contract).

The single command for all of this, once Part 1 has already run:

```bash
git revert <commit-sha-of-this-lane's-merge> --no-commit
# resolve any conflicts with work that landed after this lane, then:
git commit
```

Because Part 1 is a separate, independent mechanical gate, a partial or delayed Part 2
does not reopen any Fable-routing risk — the worst case is a dangling, functionally
inert `claude-fable-5` string in a few files, not a live routing path.

## Verifying rollback is complete

Run:

```bash
pnpm test scripts/ops/fable-pilot-rollback.test.ts
```

and separately, as a live check against the real shipped files after Part 1 has run
against them:

```bash
npx tsx -e "
import { verifyFableUnselectableAfterRollback } from './scripts/ops/fable-pilot-rollback.ts';
const result = verifyFableUnselectableAfterRollback({});
console.log(JSON.stringify(result, null, 2));
"
```

`ok: true` confirms every ratified trigger class now resolves to Sonnet.

## What this rollback does NOT need to touch

`docs/05_operations/schemas/fable-review-v1.md`, `docs/05_operations/schemas/lane_manifest_v1.schema.json`'s
`planning_model_routing` block, and the `scripts/ops/truth-check-lib.ts` Fable-evidence
check may all remain in place after a rollback — they are dormant (never triggered)
once no manifest can ever again carry `planning_model_routing.model: "claude-fable-5"`.
Removing them is optional source cleanup, not a rollback requirement.
