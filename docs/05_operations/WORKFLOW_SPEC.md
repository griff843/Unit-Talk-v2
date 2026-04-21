# Unit Talk V2 — Three-Lane Workflow Specification

**Status:** Ratified  
**Ratified by:** Claude (governance) + PM (sequencing) — UTV2-639  
**Effective:** 2026-04-21

---

## Why this exists

Unit Talk V2 operates three parallel execution lanes: Codex (implementation), Claude (governance/proof/closeout), and PM/ChatGPT (prioritization/decision-forcing). A single generic Ready→In Progress→Done flow caused false progress signals and ambiguous ownership. This spec makes the real operating model mechanical.

---

## Workflow states

All 13 states are live in Linear. The table below is the canonical definition.

| State | Type | Owner | Meaning |
|---|---|---|---|
| **PM Triage** | backlog | PM | New issue; not yet sequenced against active program |
| **Needs PM Decision** | backlog | PM | Blocked: prioritization, tradeoff, scope, or acceptance call unresolved |
| **Needs Standard** | backlog | Claude | Blocked: governing standard, contract, or success bar not explicit |
| **Ready for Codex** | unstarted | Codex | Scope, acceptance, and standards clear; Codex can execute without guessing |
| **Ready for Claude** | unstarted | Claude | Requires governance framing, proof design, decomposition, or closeout rules |
| **In Codex** | started | Codex | Codex actively implementing |
| **In Claude** | started | Claude | Claude actively defining standards, proof, framing, or closeout logic |
| **In PM Review** | started | PM | Needs sequencing review, milestone review, tradeoff arbitration, or go/no-go |
| **Blocked Internal** | started | Owner of blocker | Waiting on another Unit Talk issue or team decision |
| **Blocked External** | started | Owner of blocker | Waiting on provider, infrastructure, vendor, or outside dependency |
| **In Proof** | started | Claude | Implementation complete; live/runtime evidence gathering underway |
| **Ready to Close** | started | Claude | Technical + proof complete; only final closeout/writeup/verdict remains |
| **Done** | completed | — | Fully closed. Proof-bearing issues: evidence exists, not just code |

---

## Lane labels (required on every issue)

| Label | Applies to |
|---|---|
| `lane:pm` | Issues owned or gated by PM at some step |
| `lane:codex` | Implementation assigned to Codex |
| `lane:claude` | Governance, proof, or closeout assigned to Claude |
| `lane:shared` | Cross-lane issue; explicit owner must be named for current step |

Every issue must carry exactly one primary lane label. Add a second only if the issue genuinely requires handoff.

---

## Phase labels (required on proof/closeout issues)

| Label | Meaning |
|---|---|
| `phase:implementation` | Active build work |
| `phase:proof` | Live evidence gathering |
| `phase:closeout` | Final verdict, writeup, or ratification |

---

## Dependency labels

| Label | Meaning |
|---|---|
| `blocked:internal` | Waiting on another issue in this repo |
| `blocked:external` | Waiting on something outside the repo |
| `needs:standard` | No governing contract or success bar exists yet |
| `needs:pm-decision` | PM must make a call before work can proceed |

---

## Done gate: implementation-only vs proof-bearing

### Implementation-only issues (`phase:implementation` only)

Done requires:
- `pnpm verify` green on merge SHA
- PR merged to `main`
- Lane manifest closed (`status: "merged"`)
- Linear state = Done

### Proof-bearing issues (`phase:proof` or `phase:closeout`)

Done requires everything above **plus**:
- Issue must pass through **In Proof** before Done (skipping In Proof is a workflow violation)
- Evidence bundle exists at `docs/06_status/proof/UTV2-###/evidence.json`, tied to merge SHA
- T1: runtime proof against live Supabase; static proof alone is insufficient
- Linear state = Done only after PM sets `t1-approved` label (T1) or orchestrator on green (T2/T3)

---

## Ownership rules

| Who | Owns these states |
|---|---|
| PM (ChatGPT) | PM Triage, Needs PM Decision, In PM Review |
| Claude | Needs Standard, Ready for Claude, In Claude, Ready to Close (for proof/governance issues) |
| Codex | Ready for Codex, In Codex |
| Shared | Blocked Internal, Blocked External, In Proof (Claude leads; PM gates exit) |

Any issue in a shared lane must have an explicit owner named for the current step.

---

## Invariants

1. An issue in Ready for Codex or In Codex must have zero unresolved blockers.
2. A proof-bearing issue cannot reach Done without passing through In Proof.
3. Done without proof where proof is required is a workflow violation.
4. Every active issue must have at least one lane label.
5. T1 issues cannot move to In Codex or In Claude without PM confirmation.

---

## Canonical references

This document is the authoritative source for workflow state definitions and lane ownership. Related specs:

- `docs/05_operations/DELEGATION_POLICY.md` — tier policy and executor routing
- `docs/05_operations/TRUTH_CHECK_SPEC.md` — done-gate (`ops:truth-check`)
- `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` — proof artifact format
- `CLAUDE.md` — session discipline and lane execution expectations
