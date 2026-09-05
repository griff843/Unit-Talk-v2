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

### Delivery order

Ratified by Griff on 2026-09-05.

**First**, complete the contained internal Smart Form "Track Only" pilot — Milestone 1.

**Then**, establish ongoing internal pick submission, persistence, truthful grading/settlement, and
statistics — Milestone 2 — *before* member-facing Discord launch.

**In parallel throughout**, continue independent Command Center, pipeline, and other necessary
production work. The ordering above is a dependency ordering for the delivery path, not a
serialization of the whole board.

This statement orders the work. It introduces no readiness threshold, and it authorizes no change
to containment or to member-delivery activation — both remain reserved.

## Source of truth

Current live `griff843/Unit-Talk-v2` only: current `main`, live PRs, actual runtime and database
state, and the current canonical contracts.

Historical terminals, handoffs, and closed Linear issues are discovery material, never
current-state authority.

`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` remains the authoritative definition of
overall production readiness. No competing readiness threshold may be invented anywhere.

## Operating authority

**Griff owns:** product intent, exit criteria, and the reserved decisions below.

**Claude owns:** decomposition, sequencing, agent allocation, technical choices, implementation
coordination, verification, review coordination, integration, routine administration, and
continuation — the evolving engineering plan and its execution, including safe parallelism and
repair. Claude does not ask Griff how to implement ordinary engineering work. When Claude discovers
a defect necessary to this mission, it goes in the plan and gets solved.

**Claude does not ask whether to continue ordinary authorized work.** Ratified 2026-09-05.

### Where the work comes from

Ratified by Griff on 2026-09-05. The required work is **discovered from this mission and from
current code, runtime, and database evidence**. Claude maintains the engineering plan itself.

Existing Linear issues are **useful historical context when relevant, and must be revalidated
before being relied on**. They are a record of what was once understood — not a queue, not a
priority ordering, and not current-state authority.

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
8. Dispatching a production deployment (re-stated explicitly 2026-09-05; `deploy.yml` is
   `workflow_dispatch`-only and nothing promotes on its own)

A human gate blocks *that change*, not the mission. Other safe work continues.

### How a reserved decision is surfaced

Ratified by Griff on 2026-09-05. A reserved decision is brought to Griff **with the preparation
already complete and a concrete recommended action**: the dependent work staged and verified as far
as existing authority allows, the evidence assembled and measured rather than recalled, the options
narrowed, and one recommendation stated plainly with its consequences and its exact inputs.

Where a specific check cannot be completed because Claude lacks the access, the hand-off names **the
smallest operator action** that would close it and a **non-secret success criterion** for that
action. Restating a blocker without having completed the checks that surround it is not an
acceptable hand-off.

A reserved decision blocks only the work that depends on it. Surfacing one is never a reason to stop
the rest of the mission — see "Stop conditions" below.

## Changes to the operating model

Changes to execution authority, merge authority, tiering, agent routing, or the lane/dispatch
system are architecture decisions reserved to PM. They are proposed in a PR and reviewed as
architecture — never adopted because an agent found them more convenient, and never bundled into
a PR whose stated purpose is something else.

Until such a change is ratified, the canonical execution and governance contracts indexed in
`spec.md` are in force exactly as written.

**One such change has now been ratified**: the tracker-independence correction recorded in
"Execution must not depend on the tracker" below, ratified by Griff on 2026-09-05. It is bounded to
what that section states. Everything in the execution and governance system that the section does
not name — merge authority, the merge gate, tier risk semantics, proof bundles, lane isolation —
remains controlling exactly as written, and existing enforcement stays active until a reviewed
replacement lands.

## Execution must not depend on the tracker

Ratified by Griff on 2026-09-05, correcting a measured cost: Linear had become a precondition for
execution rather than a record of it.

**The rule.** An ordinary product task must be able to proceed from discovery through delegation,
verification, PR, and closeout **without Linear access and without an issue ID**.

**The test is availability, not automation.** Automatically setting Linear labels and states is
*insufficient*. If execution still fails when Linear is unavailable, inconsistent, or at its issue
cap, the dependency has not been removed. Any tracker synchronization that remains must be
**optional and non-blocking**.

**Remove from the execution path:** mandatory tracker lookups, mandatory issue creation, issue-ID
naming requirements, and mandatory status transitions.

**Preserve:** scope, ownership, dependencies, and traceability — carried by **repository-owned work
identity** where an identifier is genuinely needed.

**Risk classification.** Use mechanical classification as a **risk floor**, with additional
assessment where needed. Actual risk classifications are never lowered merely to eliminate tier
bookkeeping.

### Simplify the process without losing protection

These are kept, and a simplification that sacrifices one of them is not a simplification:

- isolated concurrent work
- meaningful verification
- independent review where required
- recoverable integration
- genuinely reserved approvals

**Validation is proportional to the changed files and their consequences.** An authorized intent
edit must not require unrelated application tests merely to begin. A document that changes security
or approval policy still requires substantive review — proportionality cuts both ways.

**Remove redundant administrative transitions and Git naming constraints.** Coherent work is never
split into extra issues or extra PRs solely to satisfy tracker bookkeeping.

**Align the active system, not just the prose.** The instructions, commands, hooks, and CI that
actually run must change together. Reuse the operating-model work already prepared, and coordinate
with the mission-intent edit that carries this ratification. Inspect #1491 and #1492 for reusable
changes — **their broader merge-authority changes are not automatically approved** by this
ratification and remain a separate architecture decision.

**Existing enforcement stays active until reviewed replacements land.** No guard is disabled, no
required check is bypassed, and nothing is written directly to `main`.

### Bounds on this correction

This is **one supporting workstream**. It does not authorize another general governance audit, a
backlog cleanup pass, or a replacement framework.

### Exit conditions

The cutover closes when all five hold, demonstrated rather than asserted:

1. A representative ordinary task can complete without Linear.
2. Optional tracker failures cannot block it.
3. Reserved-risk changes still require appropriate approval.
4. Fresh and compacted sessions recover the mission and current plan.
5. Existing PRs can finish without administrative restarts.

Once they hold, **close the cutover and return that capacity to product work.** Do not keep
expanding it with optional improvements.

## Governance and tooling debt policy

Ratified by PM on 2026-09-03. These are durable rules, not a new contract — nothing here creates a
contract family, a doc, or a process. They bound how governance and tooling debt is *recorded* and
*staffed*; they change no gate, no tier, and no merge authority.

**1. Filing threshold.** A new governance or tooling issue is created only when the defect blocks
active production now, has affected at least two real lanes, represents a material safety,
data-truth or security exposure, or PM explicitly decides it should be staffed. Otherwise the
finding is recorded under `plan.md` → Learned and production continues. Recording a finding is not
deferring it; it is refusing to pretend a queue position exists.

**2. One defect class, one canonical issue.** Before filing governance or tooling debt, search
Linear for the existing owner. A new occurrence is attached to the canonical issue as evidence or an
instance — never filed as a new issue. Fragmenting one defect across many issues is what makes the
backlog unreadable and the real cost invisible.

**3. The governance slot may stand empty.** The single governance/reliability slot is a ceiling, not
a quota. It is staffed only when the defect currently blocks production, repeatedly strands lanes,
materially threatens safety or data truth, or has accumulated enough *measured* operating cost to
justify the slot. An empty slot alongside moving production work is a correct state.

**Disposition of the existing backlog.** The accumulated governance backlog is not mass-closed. It
is dispositioned in a later deliberate pass that classifies each issue as canonical defect,
duplicate or instance, superseded, or genuinely deferred and accepted. Closing unstaffed work
without classifying it first would discard real diagnoses.

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

**The pilot does not wait** for the tracker-independence cutover, for Command Center completion,
or for the staging proof runner. Ratified 2026-09-05.

Ratified by PM on 2026-09-03: **step 7 may be satisfied by a governed read-only production
observation of the exact submitted pick and its non-delivery state.** A deployed Command Center is
not required for the contained pilot. "Governed" and "read-only" are both load-bearing — the
observation reads the one pick the pilot created and its delivery records, writes nothing, and
changes no containment setting.

## Milestone 2 — reliable internal operating history

Ratified by Griff on 2026-09-05. Begins after Milestone 1, and completes *before* member-facing
Discord launch.

Milestone 1 proves the path works **once**, under containment, for a single pick. Milestone 2 makes
it **routine**: internal picks are submitted and persisted reliably and repeatedly, they grade and
settle truthfully without per-pick engineering intervention, and the resulting record is queryable
as real statistics. The purpose is a genuine performance history — enough real, internally
submitted, correctly graded and settled picks that whatever is later shown to members is *earned*
rather than asserted.

Milestone 2 is done when all of the following hold on the deployed system, against live data:

1. Internal picks can be submitted through the intended surface repeatedly, by the intended
   internal operators, without per-submission engineering intervention.
2. Every submitted pick persists with canonical identity and truthful provenance — including honest
   provenance where canonical coverage is absent.
3. Grading and settlement run on their intended schedule against real results, and every settled
   pick's outcome is traceable to its score provenance.
4. Pick statistics — record, units/ROI, and CLV where the canonical contracts define it — are
   computed from the persisted history rather than recomputed ad hoc, and reconcile against the
   underlying rows.
5. An operator can observe all of the above through a governed internal surface.
6. None of the above was achieved by activating member-facing delivery.

### Containment interaction

Milestone 1 is defined to complete with containment intact. Milestone 2 is not: making submission,
grading and settlement *ongoing* may require moving one or more currently parked runtime settings
from `parked` toward `active`.

**Every such change remains a reserved decision.** Milestone 2 therefore begins by *preparing* each
one — the dependent work staged, the blast radius bounded and measured, a recommended action written
— and Griff decides it, per "How a reserved decision is surfaced" above. An agent never unparks
anything on its own initiative.

**Member-delivery activation is separately reserved and is explicitly not part of Milestone 2.**
Milestone 2 exists precisely so that delivery launches after a real history exists, not before it.

Milestone 2 introduces no readiness threshold of its own.
`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` remains the sole definition of production
readiness.

## Definition of done

The canonical production-readiness contract actually passes using its required live evidence, and
Unit Talk is operationally usable as the intended product.

Not done because: a PR merged, a ticket closed, CI turned green, or a subtask completed.

## Stop conditions

Ratified by PM on 2026-09-05, correcting an observed failure mode: agents were returning control
far too often, treating ordinary progress events as if they ended the mission.

**The mission runs continuously.** It continues until the mission or the active milestone is
complete, until every meaningful executable path is blocked pending Griff, or until a real safety
boundary prevents continued execution. Nothing else ends it.

Return to Griff only when:

- a genuinely reserved decision or action is reached **and nothing else safe remains executable**;
- a hard safety boundary fires and cannot be resolved within existing authority; or
- the mission exit criteria are actually satisfied.

**A reserved gate blocks only the work that depends on it.** Surface it, then continue every other
safe executable path. This is the same rule the execution waves already state; it is repeated here
because it is the one most often violated.

These are explicitly **not** stop conditions:

- **Waiting on CI, review, or a PR.** Refill the freed capacity with other mission work.
- **Finishing a lane or a PR.** Close it out and pick up the next thing.
- **Having something to report.** A status update is an output of the work, not a reason to stop
  doing it. Do not return control merely because you have something to say.
- **Griff asking a question, issuing a correction, or giving steering.** That is an interruption to
  incorporate, not a termination. Answer it, fold it in, and continue production.

Between stop conditions, keep orchestrating: dispatch Claude and Codex, integrate, review, merge
within existing authority, close lanes, and refill the board with independent work.

Note the interaction with the guardrail above on operating-model changes: continuing without
stopping is not permission to change how the system works. Continuous execution runs *inside* the
existing lane, tier, proof and merge-authority contracts, never around them.
