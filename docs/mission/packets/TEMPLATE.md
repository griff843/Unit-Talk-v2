# <one-line title of the work>

<!--
  A work packet is the entire contract handed to an executor (usually Codex).
  It replaces the Linear issue + lane manifest + acceptance-criteria comment
  chain of the prior operating model.

  Run it:  pnpm ops:codex-packet --packet docs/mission/packets/<this-file>.md
           (add --dry-run to print the exact prompt without invoking Codex)

  The runner REFUSES a packet missing any of Goal / Scope / Acceptance /
  Do not touch. That refusal is the point: the executor reads nothing but this
  file — not Linear, not the plan, not the conversation that produced it.

  Packets are working files, not history. Delete one once its PR has merged.
-->

Profile: codex-terra-medium

<!-- Profiles are defined in docs/05_operations/policies/codex-model-routing.json.
     codex-terra-medium = everyday bounded work. codex-sol-high = complex,
     multi-file, or root-cause work. Do not name a raw model ID here. -->

## Goal

<What must be true when this is done, in outcome terms. One paragraph.
 Say why it matters to the mission, so the executor can tell a real fix from a
 change that merely satisfies the letter of the request.>

## Context

<What the executor cannot infer from the code: the failure that motivated this,
 the constraint that is not obvious, the thing already tried that did not work.
 Paste real evidence — an error, a query result, a log line — not a summary of
 one. Omit this section only if there is genuinely nothing to say.>

## Scope

<Files and directories this work may touch, one per bullet, in backticks.
 The runner classifies these against docs/05_operations/RESERVED_RISK_SURFACES.json
 and tells you up front whether the resulting PR will need Griff at merge.>

- `apps/api/src/example-service.ts`
- `apps/api/src/example-service.test.ts`

## Acceptance

<Checkable conditions, not aspirations. Each one must be something a reviewer
 could verify without asking the author what they meant.>

- [ ] `pnpm verify` is green
- [ ] <a named test that fails if the change is reverted>
- [ ] <the observable behavior change, stated as an assertion>

## Do not touch

<Paths and behaviors that are out of bounds, and why. "Everything else" is not
 an acceptable value here — name the traps that are actually nearby.>

- Anything under `docs/mission/**` — mission intent, spec and plan are not the executor's to edit
- <the adjacent file that looks like it needs fixing but is another packet's work>

## Reporting

When done: `pnpm verify` green, PR open with the AGENTS.md body template, and a
plain statement of what was achieved and what was not. Do not close anything
out — there is nothing to close.
