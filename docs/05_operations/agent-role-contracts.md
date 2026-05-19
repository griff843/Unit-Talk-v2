# Agent Role Contracts — Unit Talk V2

> Canonical role inventory and contract format for all specialized agents in `.claude/agents/`.
>
> **Authority:** This document is Claude/governance-owned. Changes require PM review (Tier B minimum).
>
> **Produced by:** UTV2-963 (2026-05-16). Depends on UTV2-962 canonical registry reconciliation.
>
> **Truth hierarchy:** This document describes agents as they exist in the repo. If an agent file and this document disagree, the agent file wins — update this document to match.

---

## Role contract format

Every agent in `.claude/agents/` must have YAML frontmatter with these fields. The validation rules section below encodes the required structure.

### Required fields

```yaml
---
name: <kebab-case string — must match filename without .md>
description: <one-paragraph description used for routing decisions>
model: <valid Claude model ID: claude-sonnet-4-6 | claude-opus-4-7 | claude-haiku-4-5-20251001>
tools:
  - <one or more from allowed set>
---
```

### Allowed tools

Agents may only use tools that are safe for their authority level:

| Tool | Allowed for | Notes |
|---|---|---|
| Bash | All agents | Read-only commands only for advisory agents |
| Read | All agents | |
| Grep | All agents | |
| Glob | All agents | |
| Edit | Implementation agents only | Never governance/review agents |
| Write | Implementation agents only | Never governance/review agents |
| Agent | Orchestration agents only | Claude orchestrator only |

Governance/review agents **must not** use Edit, Write, or Agent tools — they report findings, never mutate state.

### Extended contract fields (in agent body)

Each agent's markdown body must define:

- **Authority boundary:** `blocking` (APPROVE/REJECT gates action) or `advisory` (reports findings, orchestrator decides)
- **Owner:** `claude-governance` (review, proof, merge gates) or `codex-implementation` (support tasks)
- **Trigger conditions:** when to invoke this agent
- **Lane types:** which lane types this agent applies to
- **Proof responsibilities:** what artifacts this agent produces or validates
- **Output format:** machine-readable structured output

---

## Current agent inventory

### 1. `codex-return-reviewer`

**File:** `.claude/agents/codex-return-reviewer.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Blocking** — returns APPROVE or REJECT |
| Trigger | After any Codex lane returns a PR; before T2 standing merge authorization is applied |
| Lane types | T2 Codex lanes |
| Proof responsibility | Validates PR scope, Tier C paths, test existence, commit format, tier label, R-level compliance |

**Purpose:** Structured gate between Codex output and Claude merge authorization. Prevents scope bleed, Tier C path touches, and malformed PRs from reaching main under the T2 standing authorization.

**Checks performed:** file scope, Tier C path guard, new `any` casts, test existence, commit message format, tier label presence, R-level compliance section, merge order section, CI check status, `Closes` marker.

**Classification:** Governance-owned. Codex must not modify this agent's check logic or authority boundary.

---

### 2. `db-proof-reviewer` *(advisory only — not a merge gate)*

**File:** `.claude/agents/db-proof-reviewer.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — operator review aid only; cannot block or authorize merge |
| Trigger | Optional — operator invokes for detailed T1 evidence narrative review |
| Lane types | T1 lanes only (optional) |
| Proof responsibility | None — does not own any required proof artifact |

**Purpose:** Operator diagnostic aid for reviewing T1 evidence bundle narrative completeness. **Not a merge gate.** The hard proof gate is `proof-auditor-gate` (CI) and `pnpm test:db` (required CI check). This agent cannot be cited as enforcement — its output is advisory context only.

**Retired as gate (UTV2-1049):** Authority downgraded from Blocking to Advisory after `proof-auditor-gate.yml` CI workflow (UTV2-1046) covers automated structural proof validation. `db-proof-reviewer` is retained as an operator convenience tool for detailed evidence narrative review.

**Classification:** Governance-owned. Advisory only — CI and PM policy are the blocking authorities. May be delegated to any executor for read-only review.

---

### 3. `lane-reconciler`

**File:** `.claude/agents/lane-reconciler.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — reports findings only; orchestrator applies fixes |
| Trigger | When `ops:health` reports drift; before starting a new dispatch cycle |
| Lane types | All (cross-cutting reconciliation) |
| Proof responsibility | None — produces a reconciliation report |

**Purpose:** Finds ghost lanes — cases where lane manifests, Linear state, and GitHub PR/branch state have drifted. Reports four categories: stale manifests, ghost manifests (no branch), orphan branches (no PR), unreconciled merges (PR merged but Linear still active).

**Checks performed:** stale manifests in `docs/06_status/lanes/`, active manifests with no remote branch, active branches with no open PR, merged PRs with active manifests, Linear state mismatch.

**Classification:** Governance-owned. Report-only — never mutates Linear, Git, or manifests. Orchestrator decides which reconciliations to apply after reviewing the report.

---

### 4. `pr-risk-reviewer`

**File:** `.claude/agents/pr-risk-reviewer.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory + conditional blocking** — LOW/MEDIUM/HIGH; HIGH on Tier C = blocks merge pending PM review |
| Trigger | Before any merge where diff is large (>500 lines), scope is wide, or tier is T1/T2 |
| Lane types | T1, T2 primarily; optional for T3 |
| Proof responsibility | Produces risk score report |

**Purpose:** Scores merge risk across six dimensions before the orchestrator applies merge authorization. Catches Tier C path exposure, new dependencies, schema changes, test coverage gaps, scope bleed, and diff size issues.

**Dimensions scored:** Tier C path exposure, dependency changes, schema changes, test coverage delta, scope bleed, diff size/complexity.

**Classification:** Governance-owned. HIGH risk on any Tier C dimension escalates to PM review regardless of tier classification. Must not be modified to lower its own sensitivity without PM approval.

---

## Ownership map

```
Claude/governance-owned (never delegate to Codex):
  codex-return-reviewer   — T2 Codex merge gate
  lane-reconciler         — drift detection (report only)
  pr-risk-reviewer        — risk scoring

Advisory only (may be used by any executor):
  db-proof-reviewer       — T1 evidence narrative review aid (not a gate, UTV2-1049)

Codex/implementation-owned (support roles):
  (none currently — all blocking agents are governance-owned)
```

Blocking agents hold governance or proof authority. None may be modified by a Codex lane without PM plan approval (Tier C by the self-amendment rule — modifying review authority is equivalent to widening orchestrator autonomy). Advisory agents (`db-proof-reviewer`) do not hold gate authority and are not subject to this restriction.

---

## Lane type → agent responsibility map

| Lane type | codex-return-reviewer | db-proof-reviewer | lane-reconciler | pr-risk-reviewer |
|---|---|---|---|---|
| T1 / Claude | — | Optional advisory | On drift | Recommended |
| T2 / Codex | Required | — | On drift | Optional |
| T2 / Claude | — | — | On drift | Optional |
| T3 / Claude | — | — | On drift | — |
| Reconciliation | — | — | Primary | — |

*`db-proof-reviewer` is advisory only — operator invokes at their discretion. The hard T1 proof gate is `proof-auditor-gate` (CI) + `pnpm test:db` (required check). (UTV2-1049)*

---

## Missing roles (proposed — not yet implemented)

Identified after inventory. These are gaps relative to the current workflow, not replacements for existing agents.

### Proposed: `codex-dispatch-preparer`

**Gap:** There is no agent that validates a Codex dispatch packet before it is sent — verifying that the issue has a tier label, AC is present, file scope is declared, and no active lane overlaps. This logic is currently embedded manually in the `/dispatch` skill.

**Proposed purpose:** Structured pre-dispatch gate for Codex lanes. Returns READY or NOT_READY with specific blockers.

**Owner:** `claude-governance` (dispatch authority belongs to Claude orchestrator)

**Note:** Should be implemented under a separate issue after UTV2-963 closes. Do not implement here.

### Proposed: `t1-plan-reviewer`

**Gap:** T1 plan approval is currently a PM dialogue in chat. There is no structured agent that checks a T1 plan for completeness (scope declared, allowed-files list present, rollback specified, no Tier C self-grants) before surfacing it to PM for approval.

**Proposed purpose:** Structured pre-PM T1 plan validation. Returns PLAN_COMPLETE or PLAN_INCOMPLETE with specific missing items. Reduces PM review time by catching structural gaps first.

**Owner:** `claude-governance`

**Note:** Should be implemented under a separate issue after UTV2-963 closes.

---

## Validation rules for agent metadata

An agent file is valid if ALL of the following hold:

1. **Filename matches name field:** `{name}.md` must equal the `name` frontmatter value.
2. **Model is a valid Claude model ID:** must be one of `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`.
3. **Tools are from the allowed set:** Bash, Read, Grep, Glob, Edit, Write, Agent, WebFetch, WebSearch. No other tools permitted.
4. **Governance agents do not include Edit/Write/Agent:** any agent whose body describes APPROVE/REJECT, VALID/INVALID, or report-only authority must not list Edit, Write, or Agent in its tools.
5. **Body defines authority boundary:** the agent body must identify whether it is enforced by automation or only advisory/manual.
6. **Body defines output format:** the agent body must include a structured output format section.
7. **No second source of execution truth:** agents must read canonical state from `.claude/lanes.json` (lane state), Linear MCP (issue state), and GitHub (PR/branch state). Agents must not maintain their own lane registry.

These rules can be mechanically validated with a script. Implementation is deferred to UTV2-967 (agent and skill schema contracts).

---

## Relationship to canonical registry (UTV2-962)

Per the registry reconciliation (UTV2-962, Done 2026-05-15):

- **Lane state:** `.claude/lanes.json` is canonical
- **Issue state:** Linear is canonical
- **PR/branch state:** GitHub is canonical
- **Proof state:** `docs/06_status/proof/` tied to merge SHA

Agents must read from these sources and must not introduce a parallel registry. The `lane-reconciler` agent exists specifically to detect when these sources drift — it does not replace any of them.
