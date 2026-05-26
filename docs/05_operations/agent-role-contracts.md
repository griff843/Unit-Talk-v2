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

### 1. `ci-triage`

**File:** `.claude/agents/ci-triage.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — diagnostic findings only; no merge block, no auto-trigger |
| Trigger | Manual — operator invokes after a CI run is already red |
| Lane types | All (cross-cutting diagnostic) |
| Proof responsibility | None — produces a remediation recommendation, not a proof artifact |
| CI enforcement | None — reactive diagnostic only (UTV2-1050 tracks automatic CI failure triage) |

**Purpose:** Diagnoses failing GitHub Actions workflow runs. Reads logs, identifies root cause, pattern-matches failure types (TypeScript, test, lint, build, env/secret, R-level, merge conflicts), returns a specific remediation. Invoked after a failure exists — never preventive.

**Checks performed:** failing step identification, log pattern matching, root cause classification, remediation recommendation.

**Classification:** Governance-owned. Advisory diagnostic — MUST NOT be cited as autonomous enforcement or proof that a guarantee holds. (UTV2-1008)

---

### 2. `codex-return-reviewer`

**File:** `.claude/agents/codex-return-reviewer.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — returns APPROVE or REJECT recommendations to the orchestrator; GitHub checks, Merge Gate, and PM policy are the blocking authority |
| Trigger | Manual — after any Codex lane returns a PR; before the orchestrator applies T2 merge authorization |
| Lane types | T2 Codex lanes |
| Proof responsibility | Validates PR scope, Tier C paths, test existence, commit format, tier label, R-level compliance |
| CI enforcement | None — transitional review aid pending UTV2-1047 automation (UTV2-1008) |

**Purpose:** Structured advisory pass over a Codex-returned PR. Catches scope bleed, Tier C path touches, and malformed PRs before the orchestrator applies merge authorization. APPROVE/REJECT findings are recommendations — not enforceable verdicts.

**Checks performed:** file scope, Tier C path guard, new `any` casts, test existence, commit message format, tier label presence, R-level compliance section, merge order section, CI check status, `Closes` marker.

**Classification:** Governance-owned. Codex must not modify this agent's check logic or authority boundary. Advisory only — cannot be cited as proof that a PR was gated correctly. (UTV2-1008)

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

### 4. `lane-governor`

**File:** `.claude/agents/lane-governor.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — concurrency recommendations to the orchestrator; dispatch scripts and manifest policy are the blocking authority |
| Trigger | Manual — invoked before `/dispatch` or `/dispatch-board` for a concise concurrency headroom summary |
| Lane types | All (cross-cutting dispatch advisory) |
| Proof responsibility | None — produces a dispatch recommendation, not a proof artifact |
| CI enforcement | None — dispatch scripts (`ops:execution-state`, `ops:lane-maximizer`) are the real enforcement layer; UTV2-1048 tracks promotion into automatic preflight artifact |

**Purpose:** Reads live lane manifests, execution state, and the concurrency policy (`docs/governance/LANE_CONCURRENCY_POLICY.md`) and recommends which lanes are safe to start. Does not start lanes, dispatch Codex, or mutate any state.

**Checks performed:** active lane count by type, executor slot availability, singleton/forbidden-combination violations, file-scope overlap, recommended dispatch plan.

**Classification:** Governance-owned. Advisory only — the actual dispatch enforcement comes from `ops:execution-state`, `ops:lane-maximizer`, and `ops:merge-risk` scripts. (UTV2-1008, UTV2-1048)

---

### 5. `lane-reconciler`

**File:** `.claude/agents/lane-reconciler.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — reports findings only; orchestrator applies fixes |
| Trigger | When `ops:health` reports drift; before starting a new dispatch cycle; automatically via `.github/workflows/ops-reconcile.yml` (daily cron + workflow_dispatch) |
| Lane types | All (cross-cutting reconciliation) |
| Proof responsibility | None — produces a reconciliation report |
| CI enforcement | Partial — `ops-reconcile.yml` is the real scheduled actor; prompt agent is for operator-directed investigation |

**Purpose:** Finds ghost lanes — cases where lane manifests, Linear state, and GitHub PR/branch state have drifted. Reports four categories: stale manifests, ghost manifests (no branch), orphan branches (no PR), unreconciled merges (PR merged but Linear still active).

**Checks performed:** stale manifests in `docs/06_status/lanes/`, active manifests with no remote branch, active branches with no open PR, merged PRs with active manifests, Linear state mismatch.

**Classification:** Governance-owned. Report-only — never mutates Linear, Git, or manifests. Orchestrator decides which reconciliations to apply after reviewing the report. The scheduled script (`ops-reconcile.yml`) is the real automated actor.

---

### 6. `pr-risk-reviewer`

**File:** `.claude/agents/pr-risk-reviewer.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — returns RISK: LOW/MEDIUM/HIGH recommendations to the orchestrator; GitHub checks, Merge Gate, and PM policy are the blocking authority |
| Trigger | Manual — before any merge where diff is large (>500 lines), scope is wide, or tier is T1/T2 |
| Lane types | T1, T2 primarily; optional for T3 |
| Proof responsibility | Produces risk score report |
| CI enforcement | None — transitional review aid pending UTV2-1047 automation (UTV2-1008) |

**Purpose:** Scores merge risk across six dimensions before the orchestrator applies merge authorization. Catches Tier C path exposure, new dependencies, schema changes, test coverage gaps, scope bleed, and diff size issues. RISK ratings are recommendations — not enforceable verdicts.

**Dimensions scored:** Tier C path exposure, dependency changes, schema changes, test coverage delta, scope bleed, diff size/complexity.

**Classification:** Governance-owned. Advisory only — cannot be cited as proof that a PR was risk-reviewed or gated correctly. HIGH risk findings should prompt operator escalation to PM but do not automatically block merge. (UTV2-1008)

### 7. `proof-auditor`

**File:** `.claude/agents/proof-auditor.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — returns VALID or INVALID findings to the orchestrator; CI (`proof-auditor-gate`) and PM policy are the blocking authority |
| Trigger | Manual — operator invokes during lane review to assess proof bundle completeness |
| Lane types | All tiers (proof review applies to any lane with required proof paths) |
| Proof responsibility | Reviews existing proof artifacts; does not produce or own any required artifact |
| CI enforcement | Partial — `proof-auditor-gate.yml` CI workflow is the automated structural gate on `docs/06_status/proof/**` PRs (UTV2-1046) |

**Purpose:** Reviews proof bundles for completeness, correct structure, SHA binding, and R-level compliance. Does not write proof files, open gates, apply labels, or block merges — audits and reports findings only.

**Checks performed:** proof file existence, required sections present, SHA binding (merge SHA not branch HEAD), R-level compliance keywords, placeholder text, evidence shape types.

**Classification:** Governance-owned. Advisory only — CI and PM policy are the blocking authorities. VALID/INVALID findings inform operator decisions; they cannot be cited as enforcement that the proof is complete. (UTV2-1008, UTV2-1046)

---

### 8. `runtime-verifier`

**File:** `.claude/agents/runtime-verifier.md`

| Field | Value |
|---|---|
| Owner | `claude-governance` |
| Authority | **Advisory** — returns VERIFIED or FAILED findings to the orchestrator; CI and PM `t1-approved` label are the blocking authority |
| Trigger | Manual — operator invokes before applying merge gate or `t1-approved` label; partial CI trigger via `runtime-verifier-gate.yml` on proof-path PRs |
| Lane types | T1 primarily; T2/T3 optional |
| Proof responsibility | Reviews CI state on the merge SHA; for T1 verifies `pnpm test:db` ran against real Supabase |
| CI enforcement | Partial — `runtime-verifier-gate.yml` runs `scripts/ops/runtime-verifier-gate.ts` only on PRs touching `docs/06_status/proof/**`; UTV2-1045 tracks expanded coverage |

**Purpose:** Confirms that a lane has actual runtime evidence — CI on the merge SHA, not just on the branch — before the merge gate opens. Checks CI status, proof readiness from execution-state, and for T1 verifies live-DB evidence. Does not re-run tests or modify files.

**Checks performed:** CI status on merge SHA (via `gh pr checks`), proof artifact readiness from `execution-state.ts`, pnpm verify status, T1-specific `pnpm test:db` evidence.

**Classification:** Governance-owned. Advisory only — VERIFIED output informs the orchestrator but is not itself a blocking gate. The CI workflow (`runtime-verifier-gate.yml`) is a real check for proof-path PRs; the prompt agent is a manual complement for broader review. (UTV2-1008, UTV2-1045)

---

## Ownership map

```
Claude/governance-owned (never delegate to Codex):
  codex-return-reviewer   — T2 Codex PR advisory review
  ci-triage               — CI failure diagnostic
  lane-governor           — dispatch concurrency advisory
  lane-reconciler         — drift detection (report only)
  pr-risk-reviewer        — risk scoring
  proof-auditor           — proof bundle advisory review
  runtime-verifier        — pre-merge runtime evidence advisory

Advisory only (may be used by any executor):
  db-proof-reviewer       — T1 evidence narrative review aid (not a gate, UTV2-1049)

Codex/implementation-owned (support roles):
  (none currently — all agents are governance-owned)
```

All prompt agents are advisory. None hold blocking gate authority — CI workflows, the Merge Gate, and PM policy are the sole blocking authorities. None may be modified by a Codex lane without PM plan approval (Tier C by the self-amendment rule — modifying review authority is equivalent to widening orchestrator autonomy).

---

## Lane type → agent responsibility map

| Lane type | ci-triage | codex-return-reviewer | lane-governor | lane-reconciler | pr-risk-reviewer | proof-auditor | runtime-verifier | db-proof-reviewer |
|---|---|---|---|---|---|---|---|---|
| T1 / Claude | On CI fail | — | Pre-dispatch | On drift | Recommended | On proof review | Recommended pre-merge | Optional advisory |
| T2 / Codex | On CI fail | Recommended | Pre-dispatch | On drift | Optional | On proof review | Optional | — |
| T2 / Claude | On CI fail | — | Pre-dispatch | On drift | Optional | On proof review | Optional | — |
| T3 / Claude | On CI fail | — | Pre-dispatch | On drift | — | — | — | — |
| Reconciliation | — | — | — | Primary | — | — | — | — |

*All agents are advisory — they inform operator decisions but do not enforce merge gates. The automated blocking gates are CI workflows, `proof-auditor-gate.yml`, and PM `t1-approved` label policy. `db-proof-reviewer` is advisory only — not a gate (UTV2-1049).*

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
7. **No second source of execution truth:** agents must read canonical state from `docs/06_status/lanes/*.json` (lane state), Linear MCP (issue state), and GitHub (PR/branch state). Agents must not maintain their own lane registry.

These rules can be mechanically validated with a script. Implementation is deferred to UTV2-967 (agent and skill schema contracts).

---

## Relationship to canonical registry (UTV2-962)

Per the registry reconciliation (UTV2-962, Done 2026-05-15):

- **Lane state:** `docs/06_status/lanes/*.json` is canonical
- **Issue state:** Linear is canonical
- **PR/branch state:** GitHub is canonical
- **Proof state:** `docs/06_status/proof/` tied to merge SHA

Agents must read from these sources and must not introduce a parallel registry. The `lane-reconciler` agent exists specifically to detect when these sources drift — it does not replace any of them.
