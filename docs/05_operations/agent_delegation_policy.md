# Unit Talk V2 — Delegation & Parallel Work Policy

> **SUPERSEDED 2026-03-28.** The active agent operating model is `docs/05_operations/AGENT_OPERATING_MODEL.md`.
> This file is preserved as historical reference only. Do not use it to inform current agent behavior.

> Version: v1.0
> Status: **Superseded** — historical record only
> Superseded by: `docs/05_operations/AGENT_OPERATING_MODEL.md`
> Last updated: 2026-03-25

---

## 1. Objective

This policy exists to make task routing consistent, fast, and safe.

It defines:
- who should do what
- when parallel lanes are appropriate
- when work must stay sequential
- how to handle limited tokens or unavailable tools
- how Claude should act as the orchestrator

This policy is intended to reduce: duplicate work, merge collisions, vague routing, tool misuse, and implementation before contract stability.

---

## 2. Core Principle

**Claude is the orchestrator.**

Claude should decide, per task:
- what kind of work it is
- whether it needs contract/spec work first
- whether it is ready for implementation
- whether it can be split into safe parallel lanes
- whether Codex, Augment, or Claude should own each lane

Claude should not improvise a new routing model every session. Claude should apply this policy.

---

## 3. Tool Roles

### Claude

**Primary role:** architecture, contracts, audits, verification, governance, sprint close, task routing, dependency analysis, final merge-readiness judgment

**Claude should usually own:**
- T1 work
- any work with unresolved architecture
- any work that changes truth sources, contracts, schema direction, or operating rules
- independent review of Codex/Augment output

### Codex

**Primary role:** bounded implementation from a clear spec/contract; primary implementation lane; multi-file code changes with known scope; deterministic coding tasks; implementation after contract ratification

**Codex should usually own:**
- T1 implementation after contract is stable
- T2 implementation
- code-first work with clear boundaries
- slices with defined files, endpoints, contracts, or tests

### Augment

Augment has two valid modes.

**A. Augment via MCP inside Claude**

Use for:
- semantic repo search
- cross-package tracing
- finding all usages of X
- locating the right files
- implementation prep / review support / impact analysis

This mode improves Claude's repo awareness. It does not create a true parallel implementation lane.

**B. Augment as a separate parallel session**

Use for:
- independent T2/T3 implementation lanes
- independent docs/spec buildout
- secondary implementation lanes that do not overlap with Codex
- non-overlapping work that benefits from a second execution stream

This is the mode that creates real parallel velocity.

---

## 4. Availability Rule

Tool routing must account for availability.

If a preferred tool is unavailable due to token limits, session limits, queue delays, tool downtime, or practical workflow constraints — route to the next best valid option without blocking progress.

### Availability fallback order

| Work type | Primary | Fallback 1 | Fallback 2 |
|-----------|---------|-----------|-----------|
| Architecture / contract / audit | Claude | Claude + Augment MCP | Claude alone (assumptions marked) |
| Repo tracing / semantic discovery | Claude + Augment MCP | Claude with repo inspection | Codex only if task is concrete |
| Bounded implementation | Codex | Augment separate session | Claude (if slice is small) |
| Parallel implementation | Codex + Augment separate | Codex only | Augment only |

**Never block waiting for perfect tooling if one valid lane can move safely.**

---

## 5. Task Classification Model

Claude should classify each task before routing it.

### T1 — governed / contract-sensitive

Examples: schema direction, provider ingestion contract, Smart Form contract, lifecycle logic changes, settlement rules, contract-bearing API work, truth-source changes

Routing:
- Claude first
- implementation only after contract/spec is stable
- Codex after ratification
- Augment MCP may assist Claude with tracing
- separate Augment implementation lane only if fully independent

### T2 — bounded implementation / product buildout

Examples: API route additions from approved spec, Command Center surfaces, Discord command implementation, UI slices from approved design, workflow automation from ratified logic

Routing:
- Codex primary
- Augment parallel when non-overlapping
- Claude reviews/closeout

### T3 — low-risk support work / docs / polish / independent support lanes

Examples: docs, audit summaries, category maps, support material, implementation notes, isolated UI polish

Routing:
- Claude, Codex, or Augment depending on fit
- parallelization allowed if no overlap

---

## 6. Parallel Work Rules

**Parallel work is allowed only when:**
- the lanes are independent
- files/modules do not overlap materially
- the contract/spec is already stable
- merge risk is low
- ownership of each lane is clear

**Parallel work is not allowed when:**
- the same files are being edited
- architecture is still unresolved
- the contract is still changing
- one lane depends directly on the output of another
- route/schema/state naming is still unsettled

---

## 7. Good and Bad Parallel Patterns

### Good

| Claude lane | Parallel lane |
|------------|--------------|
| Writes provider contract | Codex implements an unrelated Command Center slice |
| Audits repo truth | Codex implements a previously ratified slice |
| Traces repo impact via Augment MCP | Codex waits for stabilized contract |
| — | Codex implements API routes while Augment separately drafts Discord spec docs |

### Bad

- Codex and Augment editing the same server file
- Claude changing the contract while Codex is already implementing it
- Two tools implementing overlapping route logic
- Parallel lanes that share unresolved schema assumptions

---

## 8. Default Routing Rules

| # | Rule |
|---|------|
| 1 | If architecture is unresolved, Claude goes first. |
| 2 | If the task is implementation-ready, Codex is the default primary implementer. |
| 3 | If semantic repo tracing is needed, use Augment MCP through Claude when available. |
| 4 | If there is a second safe implementation lane, use Augment separately in parallel when available. |
| 5 | If tools are limited, keep momentum with the next best valid option instead of waiting for ideal conditions. |
| 6 | No implementation starts on T1 work until the contract/spec is stable enough. |

---

## 9. Standard Operating Flow

### For T1 work
1. Claude audits and defines the contract
2. Claude uses Augment MCP when available for repo tracing
3. Claude finalizes the contract/spec
4. Codex implements from the approved contract
5. Claude performs independent review and closeout

### For T2 work
1. Claude confirms the slice is bounded
2. Codex implements
3. Augment may run a separate parallel lane when available and safe
4. Claude verifies and closes

### For T3 work
1. Claude routes to the fastest safe tool
2. Parallelization is allowed if there is no overlap
3. Claude reconciles results if needed

---

## 10. Delegation Decision Rubric for Claude

For each new task, Claude should answer:

1. Is this T1, T2, or T3?
2. Is the architecture/contract already stable?
3. Does this require repo tracing first?
4. Is Codex the best primary implementer?
5. Is Augment MCP useful here?
6. Is there a safe parallel lane?
7. Are Codex/Augment available right now?
8. If not, what is the next best valid routing choice?

Claude should then explicitly state:
- what stays in Claude
- what goes to Codex
- what goes to Augment
- what runs in parallel
- what must wait

---

## 11. Token / Capacity Handling

### Claude constrained
- keep Claude focused on contract/audit/verification only
- push bounded implementation to Codex when available
- defer noncritical prose or broad brainstorming

### Codex constrained
- use Augment separately for independent implementation when available
- or let Claude hold the lane until Codex is available

### Augment constrained
- use MCP mode only if available
- otherwise let Claude inspect directly
- do not stall implementation if Codex can already proceed safely

**General rule: Do not block on ideal tool availability if a safe next-best path exists.**

---

## 12. Non-Negotiable Constraints

- no overlapping implementation lanes on the same files
- no T1 implementation before contract stability
- no tool used outside its strength when a better available option exists
- no fake parallelism where one tool is just duplicating another
- no merge/close until Claude or equivalent final verifier reviews bounded outputs

---

## 13. Success Criteria

This policy is working if:
- tasks are routed faster
- fewer overlapping edits happen
- contracts are written before sensitive implementation
- Codex is used more efficiently
- Augment is used intentionally, not decoratively
- token/tool limitations do not stall momentum
- Claude acts as the stable orchestrator across sessions

---

## 14. Practical Default for Unit Talk V2

| Tool | Role |
|------|------|
| Claude | audit, contract, governance, verification |
| Augment MCP (when available) | repo tracing inside Claude sessions |
| Codex | primary implementation |
| Augment separate (when available) | secondary parallel implementation on independent T2/T3 work |

This is the default operating model unless a task clearly justifies an exception.

---

## Related docs

- `docs/05_operations/delivery_operating_model.md` — lane ownership + tool routing table
- `docs/05_operations/SPRINT_MODEL_v2.md` — tier requirements
- `docs/05_operations/docs_authority_map.md` — authority chain
- `docs/06_status/production_readiness_checklist.md` — item 0.14
