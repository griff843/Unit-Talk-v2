# Mission Intent — Unit Talk Production Recovery

**Owner:** Griff (human). Claude does not edit this file except to record changes Griff has ratified.
**Status:** ACTIVE
**Opened:** 2026-09-02

---

## Mission

Recover Unit Talk from a partially complete, operationally fragmented state into a finished,
trustworthy, production-ready, revenue-generating product.

There is no separate "Production Recovery" workstream and no separate "Factory OS" project that
production waits on. The recovery itself establishes the minimum AI-native operating system
required to finish the product.

## Source of truth

Current live `griff843/Unit-Talk-v2` only: current `main`, live PRs, actual runtime and database
state, and the current canonical contracts.

Historical terminals, handoffs, and closed Linear issues are discovery material, never
current-state authority.

`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` remains the authoritative definition of
overall production readiness. No competing readiness threshold may be invented anywhere.

## Operating authority

**Griff owns:** product intent, exit criteria, and the reserved decisions below.

**Claude owns:** the evolving engineering plan, decomposition, sequencing, safe parallelism,
repair, integration, and continuation. Claude does not ask Griff how to implement ordinary
engineering work. When Claude discovers a defect necessary to this mission, it goes in the plan
and gets solved.

Griff's stated intent is that agents should not stop for *administrative state* when the question
in front of them is neither a product decision nor a real risk decision. Reducing that overhead is
a mission goal.

**How that goal is pursued is itself a PM decision, not an agent decision.** The execution and
governance system currently on `main` — lanes, lane manifests, `ops:lane-start` / `ops:lane-close`,
`ops:truth-check`, tiers, proof bundles, `/dispatch`, and Linear as workflow intent — remains
controlling until PM ratifies a replacement. An agent may propose a change to it and must not
adopt one unilaterally. See "Changes to the operating model" below.

## Reserved decisions and actions (require Griff)

1. Production DDL and production data deletion
2. Member-delivery activation
3. Paid provider / subscription commitments
4. Secrets
5. Pricing and tier authority
6. Changes to production containment while containment is mandated
7. Changes to merge authority itself — the merge gate, its policy inputs, CODEOWNERS, branch protection

A human gate blocks *that change*, not the mission. Other safe work continues.

## Changes to the operating model

Changes to execution authority, merge authority, tiering, agent routing, or the lane/dispatch
system are architecture decisions reserved to PM. They are proposed in a PR and reviewed as
architecture — never adopted because an agent found them more convenient, and never bundled into
a PR whose stated purpose is something else.

Until such a change is ratified, the canonical execution and governance contracts indexed in
`spec.md` are in force exactly as written.

## Standing prohibitions

- Ordinary direct-`main` bypass is prohibited. All planned work lands via PR on green CI, per
  `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`. Detection alone is not prevention: a red
  Direct Main Push Guard run is an incident to record, not a formality to note.
- Production containment stays fail-closed until a mission milestone explicitly authorizes change.
- Real safety mechanisms already built are preserved.
- Guardrails in `docs/05_operations/STANDING_GUARDRAILS.md` hold regardless of any single directive.

## Multi-model execution

Claude owns mission orchestration and integration. Codex is used for bounded implementation,
debugging, testing, and independent review where that is the efficient choice; its slice is defined
by the assigned work packet. Gemini is desired as an independent model-family reviewer for
high-risk security and architecture work and for large-context analysis; it is non-blocking until
installed and proven useful, and no product work waits on it.

Work is routed on outcome, risk, and comparative model strength — not on model consensus.

## Milestone 1 — contained internal Smart Form "Track Only" pilot

Griff, personally, end to end:

1. reaches the deployed form
2. authenticates successfully
3. resolves canonical identity as `griff843`
4. submits a **real internal Track Only pick**
5. the pick persists correctly
6. Track Only is *proven* unable to create member delivery
7. the result is observed securely through the intended internal/operator path

This is a milestone, not the definition of production readiness.

### What step 4 does and does not require

Step 4 requires a *real* pick — a genuine current selection Griff actually intends, submitted
through the deployed form, persisted as a real row. It does **not** require canonical reference
data to be populated.

Containment deliberately keeps provider ingestion parked, so the canonical team and player catalogs
are not being filled. Requiring canonical reference-data coverage as a precondition would make the
pilot depend on unparking the very system this milestone is designed to leave parked. Instead,
**honest structured or manual provenance is acceptable for this contained pilot**: a pick submitted
through the structured canonical path where coverage exists, or through the manual
`canonical-coverage-gap` path where it does not, provided the provenance recorded on the pick is
truthful about which path was used. What is not acceptable is a fabricated selection, a synthetic
fixture, or provenance that claims canonical resolution it did not have.

### Containment during Milestone 1

Milestone 1 is a *contained* pilot. For its entire duration, and as a condition of it being
considered done, all of the following remain parked:

- paid provider ingestion
- provider activation or subscription purchase
- system picks (`SYNDICATE_MACHINE_MODE` stays `parked`)
- member-facing delivery and every deferred delivery target

None of these may be unparked to make the pilot complete. A pilot that required unparking any of
them would not have proven what this milestone exists to prove.

### Step 7 — observation path

Step 7 requires that the result be observed **securely, through an internal/operator path**. It
does **not** require the public Command Center to be deployed, and it does not make any Command
Center secret a prerequisite.

A safe read-only internal or operator observation path that demonstrates the pick's persisted
identity, distribution mode, provenance and the absence of any delivery record satisfies step 7.
Deploying the Command Center remains desirable product work and is tracked on its own merits; it is
not a Milestone 1 gate.

## Definition of done

The canonical production-readiness contract actually passes using its required live evidence, and
Unit Talk is operationally usable as the intended product.

Not done because: a PR merged, a ticket closed, CI turned green, or a subtask completed.

## Stop conditions

Return to Griff only when:

- a genuinely reserved decision or action is reached;
- a hard safety boundary fires and cannot be resolved within existing authority; or
- the mission exit criteria are actually satisfied.

Otherwise, keep working.
