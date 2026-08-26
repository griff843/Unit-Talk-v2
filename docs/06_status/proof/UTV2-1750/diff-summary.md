# Diff Summary — UTV2-1750

## Scope

Wire the four already-drafted operational skills (`/lane-recovery`, `/pr-unblock`,
`/proof-authoring`, `/mutation-test`) into dispatch routing and into the
execution packet's definition-of-done gate.

## Files changed (implementation, excludes lane bookkeeping and `.gitkeep`)

```
 .claude/commands/dispatch.md         |  22 ++
 .claude/commands/lane-recovery.md    | 161 ++++++++++++
 .claude/commands/mutation-test.md    | 128 ++++++++++
 .claude/commands/pr-unblock.md       | 150 ++++++++++++
 .claude/commands/proof-authoring.md  | 146 +++++++++++
 CLAUDE.md                            |   4 +
 scripts/ops/execution-packet.test.ts | 462 ++++++++++++++++++++++++++++++++++-
 scripts/ops/execution-packet.ts      | 268 +++++++++++++++++++-
 8 files changed, 1328 insertions(+), 13 deletions(-)
```

Command: `git diff --stat origin/main...HEAD -- scripts/ apps/ packages/ .claude/ CLAUDE.md`

(Lane bookkeeping files `.ops/sync/UTV2-1750.yml`, `docs/06_status/lanes/UTV2-1750.json`,
and `docs/06_status/proof/UTV2-1750/.gitkeep` were produced by `ops:lane-start`
before this lane's implementation work began and are excluded from the count
above per `/proof-authoring` guidance, to avoid the proof bundle inflating its
own diff.)

## What changed

1. **Four skill files landed** (`lane-recovery.md`, `pr-unblock.md`,
   `proof-authoring.md`, `mutation-test.md`), copied verbatim from complete,
   pre-existing drafts in the main checkout, and indexed in `CLAUDE.md`'s
   skills table (4 new rows between `/verification` and `/code-structure`).

2. **`scripts/ops/execution-packet.ts`**:
   - New `SkillRoutingResult` type and `SKILL_ROUTING_SPECS` table (4 regex
     trigger specs, one per skill) — the single source of truth for routing.
   - `deriveSkillRouting(contract)` — matches contract text against the
     trigger table and returns `{ selected_skills, reasons, note }`.
   - `taskContractFullText(contract)` — flattens a `TaskContract`'s
     narrative fields into one searchable string.
   - `ExecutionPacket.skill_routing` — new field populated by
     `generateExecutionPacket`, so `/dispatch`'s Phase 1.5 can read
     `selected_skills` directly from the packet.
   - `InsufficientTaskContractError` + `assertSufficientTaskContract()` — a
     new **opt-in** (`ExecutionPacketOptions.enforceSufficiency`, default
     `false`) refusal that fails closed with code
     `INSUFFICIENT_TASK_CONTRACT` when a task contract lacks
     where-to-look, definition-of-done, or verification/self-check content.
   - `executionPacketFailure` extended with an `INSUFFICIENT_TASK_CONTRACT`
     branch carrying a `missing: string[]` field.
   - The standalone CLI entrypoint (`main()`) is the one caller that sets
     `enforceSufficiency: true` — this is the preflight gate `/dispatch`'s
     new Phase 1.5 invokes before any executor launches. All other existing
     callers (`claude-exec.ts`, `codex-exec.ts`, `lane-start.ts` — out of
     this lane's file scope) are unaffected because the flag defaults off.

3. **`.claude/commands/dispatch.md`**:
   - New `Phase 1.5: Deterministic skill discovery` section, run for every
     validated target before Phase 4 (executor launch). It shells out to
     `npx tsx scripts/ops/execution-packet.ts UTV2-{number}` and treats
     `skill_routing.selected_skills` as the routing authority — the
     prose trigger table in the doc is explicitly marked non-authoritative,
     pointing back at `SKILL_ROUTING_SPECS` as the real source (avoiding a
     second, driftable copy of the routing table).
   - The Phase 4 Claude-lane background-agent prompt template now
     interpolates the routed skill list (or an explicit "none matched"
     line) so the executor sees which skill(s) Phase 1.5 selected.

4. **`scripts/ops/execution-packet.test.ts`**: 45 new test cases covering
   skill-table stability, 8 positive/negative routing fixtures (2 per
   skill), a multi-skill-overlap case, an ordinary-narrow-implementation
   negative case, a 4-mutation battery against
   `assertSufficientTaskContract` (removing where-to-look /
   definition-of-done / verification content individually and together),
   an opt-in-default-off regression test, and a full UTV2-1736 production
   lane fixture proving its objective/constraints/mutation-boundary/proof
   requirements survive `TaskContract` parsing and do not falsely trigger
   any of the four skills.

## Why

Deterministic skill discovery is required so `/dispatch` reliably routes to
`/lane-recovery`, `/pr-unblock`, `/proof-authoring`, and `/mutation-test` on
the trigger conditions named in UTV2-1750, rather than depending on an
executor to remember an unindexed skill exists. The sufficiency gate ensures
a task contract missing the minimum content a skill or executor needs
(where to look, what "done" means, how to verify) is refused before
executor launch instead of silently producing an under-specified packet.
