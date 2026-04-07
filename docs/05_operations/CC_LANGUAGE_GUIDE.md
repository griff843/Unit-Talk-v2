# Command Center Language Guide

## Metadata

| Field | Value |
|-------|-------|
| Status | Ratified |
| Issue | UTV2-413 |
| Ratified | 2026-04-07 |
| Owner | Program Owner |

This document is the authoritative naming reference for the operator intelligence surface in Unit Talk V2. It resolves ambiguity between internal package identifiers and user-facing product names.

---

## The Rule in One Sentence

The product surface is always called **Command Center**. The internal package identifiers (`apps/operator-web`, `apps/command-center`) are code-level names and are never surfaced to operators or in product docs.

---

## Naming Reference Table

| Context | Correct | Incorrect |
|---------|---------|-----------|
| Product surface name (user-facing) | Command Center | Operator Dashboard, Operator Web |
| Feature names in docs | Command Center dashboard, Command Center workspace | Operator dashboard, Operator web UI |
| Internal package directories | `apps/operator-web`, `apps/command-center` | (no change — package names stay as-is) |
| Role noun for the person using it | operator, admin | (no change — role nouns are fine) |
| Internal code comments | operator, operator surface | (acceptable — role noun context) |
| API route namespace | `/api/operator/...` | (no change — internal routing stays as-is) |
| TypeScript type names | `OperatorSnapshot`, `OperatorRepository` | (no change — code identifiers stay as-is) |
| Historical Linear issue titles | (preserve as-is) | (do not retroactively rename issue titles) |

---

## Where "Command Center" Is Required

Use **Command Center** in:

- All product documentation describing what operators see and do
- Surface registry entries (e.g., in `PLATFORM_SURFACES_AUTHORITY.md`)
- Feature descriptions that reference the dashboard UI
- Contract docs describing what a feature exposes "in the Command Center"
- Any sentence of the form "the [product surface] displays X" or "visible in [product surface]"

Examples:

| Before | After |
|--------|-------|
| "the operator dashboard displays CLV in the pick detail view" | "Command Center displays CLV in the pick detail view" |
| "Conviction visible in operator dashboard" | "Conviction visible in Command Center" |
| "Settlement Recap section in the operator dashboard" | "Settlement Recap section in Command Center" |
| "### Operator Web — Read-Only Monitoring" | "### Command Center — Operator Intelligence Dashboard" |
| "operator dashboard shows grading results" | "Command Center shows grading results" |

---

## Where "operator" Remains Valid

Use **operator** (lowercase, as a role noun) in:

- Descriptions of the person: "for operators", "an operator reviewing picks", "operator access"
- Internal package names: `apps/operator-web`, `apps/command-center` — these are code identifiers and must not be renamed
- API route namespaces: `/api/operator/snapshot`, `/api/operator/review-queue` — internal HTTP paths are not product surface names
- TypeScript identifiers: `OperatorSnapshot`, `OperatorRepository`, `handleOperatorRequest` — code stays as-is
- Internal code comments where "operator" describes the role, not the surface name
- `COMMAND_CENTER_AUDIT.md` technical route inventory — section headers referencing `operator-web` as the backing app are accurate and should be preserved

---

## Where "Operator Web" Remains Valid

`operator-web` is a valid term only when explicitly referring to the **backing application package** (`apps/operator-web`) in a technical context:

- Architecture docs describing the two-app architecture: "Command Center reads from `operator-web`"
- Audit docs inventorying `operator-web` routes
- Package dependency graphs

It must **not** appear as a product surface name or dashboard label.

---

## Common Rewrite Patterns

### Surface heading in product docs

```
Before: ### Operator Web — Read-Only Monitoring
After:  ### Command Center — Operator Intelligence Dashboard
```

### Feature delivery notes

```
Before: "the operator dashboard shows grading results via existing settlement surfaces"
After:  "Command Center shows grading results via existing settlement surfaces"
```

### Acceptance criteria

```
Before: "the operator dashboard renders the recap output"
After:  "Command Center renders the recap output"
```

### Scope exclusion notes

```
Before: "No operator web changes — the operator dashboard shows grading results"
After:  "No Command Center changes — Command Center shows grading results via existing settlement surfaces"
```

### Future work items

```
Before: "Conviction visible in operator dashboard"
After:  "Conviction visible in Command Center"
```

---

## Package Architecture Note

The product surface branded as **Command Center** is backed by two internal packages:

- `apps/operator-web` — read-only data backend (JSON API layer)
- `apps/command-center` — Next.js 14 UI that consumes `operator-web` APIs

Neither package name is a product surface name. Both are internal implementation identifiers. The combined product presented to operators is always **Command Center**.

---

## Enforcement

- New docs must use "Command Center" for the product surface
- PRs that introduce "Operator Dashboard" or "Operator Web" as product surface names will be flagged for correction
- Internal code comments and identifiers are exempt from this rule
- Historical Linear issue titles are exempt from retroactive renaming
