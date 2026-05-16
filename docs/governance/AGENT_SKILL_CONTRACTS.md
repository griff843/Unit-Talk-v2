# Agent and Skill Schema Contracts

**Authority:** Claude/governance-owned. Changes require PM review.
**Produced by:** UTV2-967 (2026-05-16).
**Depends on:** UTV2-962 (canonical registry), UTV2-963 (agent role inventory), UTV2-964 (skill registry).

---

## Purpose

This document defines machine-readable schema contracts for execution agents (`.claude/agents/`) and reusable skills (`.agents/skills/`). These schemas enable automated validation of roles, ownership, authority boundaries, and proof responsibilities.

The prose role inventory lives in `docs/05_operations/agent-role-contracts.md`. This document provides the validation rules and TypeScript interface definitions that enforce that contract mechanically.

---

## Agent contract schema

### Required frontmatter fields

Every agent file in `.claude/agents/` must have YAML frontmatter with all of the following fields:

```typescript
interface AgentContract {
  name: string;         // kebab-case; must exactly match the filename (without .md)
  description: string;  // non-empty; used for routing and selection decisions
  model: ClaudeModel;   // one of the valid Claude model IDs
  tools: string[];      // non-empty array of allowed tool names
}

type ClaudeModel =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'claude-haiku-4-5-20251001';
```

### Agent validation rules

| Code | Rule |
|------|------|
| A1 | `name` field is missing from frontmatter |
| A2 | `name` does not match the filename (without `.md`) |
| A3 | `description` is missing or empty |
| A4 | `model` field is missing |
| A5 | `model` is not a recognized Claude model ID |
| A6 | `tools` is missing or an empty array |
| A7 | A governance agent uses a mutating tool (Edit, Write, Agent) |

### Authority boundary

All agents in `.claude/agents/` are **governance-owned** (`claude-governance`). They must not use tools that mutate state:

| Forbidden tool | Why |
|---|---|
| `Edit` | Modifies files — governance agents report, never mutate |
| `Write` | Creates files — same restriction |
| `Agent` | Spawns sub-agents — reserved for the Claude orchestrator |

Allowed tools for governance agents: `Bash` (read-only), `Read`, `Grep`, `Glob`.

---

## Skill contract schema

### Current state

Existing `.agents/skills/*/SKILL.md` files have minimal YAML frontmatter (`name`, `description`). Full schema compliance is not yet required — migration notes report missing fields without blocking.

### Target schema (required for `.execution/skills/` promotion)

```typescript
interface SkillContract {
  name: string;            // required for promotion
  description?: string;    // required for cross-agent routing
  category?: SkillCategory;
  owner?: string;
  trigger?: string;
}

type SkillCategory =
  | 'implementation'
  | 'governance'
  | 'review'
  | 'verification'
  | 'documentation';
```

### Skill validation rules

| Code | Severity | Rule |
|------|----------|------|
| S1 | Migration note | `name` field missing — required for `.execution/skills/` promotion |
| S2 | Migration note | `description` field missing — required for cross-agent routing |
| S3 | Migration note | `category` field missing |
| S4 | Hard failure | `category` value is not a recognized `SkillCategory` |

Migration notes indicate readiness gaps for `.execution/skills/` namespace promotion. They do not block current usage from `.agents/skills/`.

---

## Compatibility plan

### Phase 1 — current state (this issue)

- `.claude/agents/` agents validated against the full agent schema (A1–A7 are hard failures).
- `.agents/skills/` skills validated with migration notes only (S1–S3 are notes; S4 is a hard failure).
- No files moved. No skills renamed.

### Phase 2 — skill migration prep (future issue)

- Add `category`, `owner`, `trigger` fields to all `.agents/skills/*/SKILL.md` files.
- After all migration notes are cleared, skills become eligible for promotion to `.execution/skills/`.

### Phase 3 — `.execution/skills/` namespace (requires PM approval)

- Skills promoted to `.execution/skills/` must satisfy the full `SkillContract` schema.
- Migration requires: (a) PM approval, (b) cross-agent compatibility test, (c) lane manifest update.
- `.agents/skills/` remains authoritative until migration is ratified.

---

## Validation CLI

```bash
# Validate all agents and skills from repo root
npx tsx scripts/ops/contract-validator.ts

# Exit code 0: all agents valid (skills may have migration notes)
# Exit code 1: one or more agents failed validation
```

Output format (JSON):

```json
{
  "agents": [
    {
      "file": ".claude/agents/codex-return-reviewer.md",
      "valid": true,
      "failures": [],
      "contract": { "name": "...", "description": "...", "model": "...", "tools": [...] }
    }
  ],
  "skills": [
    {
      "file": ".agents/skills/betting-domain/SKILL.md",
      "valid": true,
      "failures": [],
      "migrationNotes": ["S3: category field missing ..."]
    }
  ],
  "summary": {
    "agentsValid": 4,
    "agentsInvalid": 0,
    "skillsValid": 19,
    "skillsWithNotes": 19
  }
}
```

---

## Ownership

This document is Claude/governance-owned. Codex may not modify the authority boundary definitions or downgrade any validation rule from hard failure to advisory without PM approval. The governance agent tool restriction (A7) is a hard invariant.
