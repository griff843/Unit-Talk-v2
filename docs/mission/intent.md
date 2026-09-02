# Mission Intent — Unit Talk Production Recovery

**Owner:** Griff (human). Claude does not edit this file except to record ratified changes Griff states.
**Status:** ACTIVE
**Opened:** 2026-09-02

---

## Mission

Recover Unit Talk from a partially complete, operationally fragmented state into a finished,
trustworthy, production-ready, revenue-generating product.

There is no separate "Production Recovery" workstream and no separate "Factory OS" project that
production waits on. The recovery itself establishes the minimum AI-native operating system
required to finish the product.

## Execution primitive

The prior primitive — Linear issue → lane → manifest → proof bundle → closeout reconciliation →
human relay — produced strong safety mechanisms but excessive coordination overhead, and repeatedly
stopped capable agents for *administrative state* rather than real product or risk decisions.

It is replaced by:

```
intent → canonical requirements → Claude-owned plan
      → Claude/Codex/Gemini execution → worktrees/PRs
      → CI/review → deploy/observe → plan update → continue
```

Linear is historical/portfolio/inbox information during transition. It is not execution authority.

## Source of truth

Current live `griff843/Unit-Talk-v2` only: current `main`, live PRs, actual runtime/database state,
and current canonical contracts.

Historical terminals, handoffs, and Linear issues are discovery material, never current-state authority.

`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` remains the authoritative definition of
overall production readiness. No competing readiness thresholds may be invented.

## Operating authority

**Griff owns:** product intent, exit criteria, and the reserved decisions below.

**Claude owns:** the evolving engineering plan, decomposition, sequencing, safe parallelism, repair,
integration, and continuation. Claude does not ask Griff how to implement ordinary engineering work.
When Claude discovers a defect necessary to this mission, it goes in the plan and gets solved — no
ticket is created merely to grant permission to work.

## Reserved decisions and actions (require Griff)

These are enumerated mechanically in `docs/05_operations/RESERVED_RISK_SURFACES.json`
and enforced by `.github/workflows/merge-gate.yml`.

1. Production DDL and production data deletion
2. Member-delivery activation
3. Paid provider / subscription commitments
4. Secrets
5. Pricing and tier authority
6. Changes to production containment while containment is mandated
7. Changes to merge authority itself (the gate, its policy file, CODEOWNERS, branch protection)

A human gate blocks *that change*, not the mission. Other safe work continues.

## Standing prohibitions

- Ordinary direct-`main` bypass remains prohibited. All work lands via PR on green CI.
- Production containment stays fail-closed until a mission milestone explicitly authorizes change.
- Real safety mechanisms already built are preserved. Administrative relay is not a safety mechanism.

## Multi-model execution

Claude owns mission orchestration and integration. Codex is used for bounded implementation,
debugging, testing, and independent review where that is the efficient choice. Gemini is desired as
an independent model-family reviewer for high-risk security/architecture and large-context analysis;
it is non-blocking until installed and proven useful. Work is routed on outcome, risk, and
comparative model strength — not on model consensus.

## Milestone 1 — contained internal Smart Form "Track Only" pilot

Griff, personally, end to end:

1. reaches the deployed form
2. authenticates successfully
3. resolves canonical identity as `griff843`
4. submits a real canonical pick
5. the pick persists correctly
6. Track Only is *proven* unable to create member delivery
7. the result is observed securely through the intended operator path

This is a milestone, not the definition of production readiness.

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
