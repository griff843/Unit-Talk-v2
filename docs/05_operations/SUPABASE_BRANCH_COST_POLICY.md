# Supabase Branch and Cost Governance Policy

**Status:** RATIFIED
**Date:** 2026-05-08
**Linear:** UTV2-867
**Parent:** UTV2-855 (DB truth / schema discipline umbrella)
**Tier:** T2 — Operations
**Authority:** PM (A Griffin). Owned.

---

## Purpose

This document governs Supabase preview branch creation, lifecycle, cost controls, and resource ownership. It prevents uncapped compute spend from abandoned branches and ensures branch state is always traceable to a specific lane.

---

## Branch Governance Policy

### Creation authority

Only the operator (A Griffin) may create Supabase preview branches. This is a standing policy, not a temporary restriction.

Agents (Claude, Codex) must not create branches:
- Via the Supabase MCP `create_branch` tool
- Via the Supabase CLI (`supabase branches create`)
- Via any GitHub Actions workflow that auto-creates branches

The rationale: each preview branch incurs compute cost from the moment it is created. Uncontrolled branch creation creates uncapped billing exposure with no way to attribute cost to a specific decision.

### When to create a branch

Preview branches are justified for:

1. Staging a high-risk migration (Destructive or Cron-mutating class) before production apply
2. Validating a schema change that requires a live Supabase context but should not touch production
3. Operator-directed testing that requires an isolated DB snapshot

Preview branches are not justified for:
- Standard T2 or T3 migration development (use local Docker instead)
- Exploratory schema experiments
- Running `pnpm test:db` in isolation (target local or production directly)
- Agent-directed investigation without operator instruction

### Naming convention

Branches must follow this naming pattern:

```
utv2-###-description
```

Example: `utv2-856-migration-workflow-staging`

The issue ID prefix makes cost attribution and lifecycle management tractable. Unnamed or arbitrarily named branches are unauthorized and must be deleted.

---

## Environment Lifecycle Policy

| State | Trigger | Action required |
|---|---|---|
| **Active** | Branch created, PR open | Operator tracks in lane manifest (optional) or Linear comment |
| **Merge-ready** | PR approved, CI green | Migration validated on branch — schedule deletion |
| **Post-merge** | PR merged to main | Delete branch within 72 hours |
| **Stale** | PR closed without merge | Delete branch within 24 hours |
| **Orphaned** | No linked PR or issue | Delete immediately |

Branch deletion:
- Via Supabase Dashboard: Branches → select branch → Delete
- Via CLI: `supabase branches delete <branch-id>`
- Via Supabase MCP `delete_branch` tool (operator executes)

### Enforcement

The operator reviews active branches in the Supabase Dashboard before starting any session involving DB work. Any branch without a live, open PR or active lane is orphaned and must be deleted.

---

## Cost-Control Standards

### Cost model

Supabase preview branches consume compute at the plan rate from creation until deletion. At the current Pro plan:

- Each branch is a full isolated project instance
- Cost accumulates continuously while the branch exists
- No automatic expiry — branches persist until explicitly deleted

### Limits and guardrails

| Control | Policy |
|---|---|
| Maximum concurrent branches | 2 (one per active T1 lane; T2/T3 use local) |
| Maximum branch age | 72 hours from creation without operator renewal |
| Idle branch (no recent `db push` or test run in > 24h) | Delete unless operator has an active reason to retain |
| Unauthorized branch (no linked issue) | Delete immediately |

### Cost attribution

Every branch must have a UTV2 issue ID in its name. This is the only way to attribute branch cost to a specific delivery decision.

If a branch cost cannot be attributed to an issue, it is an operational leak.

---

## Preview Branch Restrictions

The following are not permitted on preview branches:

| Action | Why restricted |
|---|---|
| Using a preview branch as a long-lived staging environment | Branches are ephemeral. Long-lived staging belongs in a dedicated Supabase project, not a branch. |
| Applying data backfills to a preview branch without confirming branch state matches production | Preview branch may have diverged schema — backfill results may not transfer. |
| Running cron jobs on a preview branch that target production tables | Cross-environment cron writes are unauthorized. |
| Sharing preview branch credentials externally | Preview branches inherit the project's service role key. External sharing creates a security exposure. |
| Keeping a preview branch after its originating PR is closed | Dead cost. Delete immediately. |

---

## Resource Ownership

| Resource | Owner | Can delegate? |
|---|---|---|
| Supabase project (`zfzdnfwdarxucxtaojxm`) | A Griffin (operator) | No |
| Supabase access token (`sbp_...`) | A Griffin (operator) | No — never share |
| Preview branch creation | A Griffin (operator) | Per-session to agent with explicit instruction |
| Preview branch deletion | A Griffin (operator) | Per-session to agent with explicit instruction |
| Service role key | A Griffin (operator) | Used by API, worker, ingestor in production — never browser |

### Credential hygiene

- `SUPABASE_ACCESS_TOKEN` is stored in `local.env`. Never commit to git. Never paste in PR descriptions or chat.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose to the browser or smart-form.
- If a credential is accidentally committed: rotate it immediately via the Supabase Dashboard, then update `local.env`.

---

## Supabase MCP Tool Policy

The Supabase MCP tools (`mcp__supabase__*` and `mcp__claude_ai_Supabase__*`) expose destructive operations. Agent policy:

| Tool | Agent may use | Notes |
|---|---|---|
| `list_tables` | Yes — always | Read-only schema inspection |
| `execute_sql` (SELECT) | Yes | Read-only queries |
| `execute_sql` (write) | Only with per-session operator authorization | Must state which table and what mutation |
| `apply_migration` | Only with per-session operator authorization for the specific migration | Names the migration file explicitly |
| `create_branch` | Never autonomously | Operator creates only |
| `delete_branch` | Only with per-session operator authorization for the specific branch ID | |
| `merge_branch` | Never autonomously | Operator merges only |
| `reset_branch` | Never autonomously | Destructive — PITR equivalent |
| `generate_typescript_types` | Yes — read-only | Equivalent to `pnpm supabase:types` |
| `get_logs` | Yes — read-only | Debugging only |
| `get_advisors` | Yes — read-only | Schema health diagnostics |

---

## Audit and Review Cadence

The operator performs a branch audit at the start of each session involving DB work:

1. Open Supabase Dashboard → Branches
2. For each active branch: confirm it has a linked open PR or active lane
3. Delete any orphaned, stale, or anonymous branches
4. Record the audit outcome in the session's Linear comment if branches were deleted

No formal tooling is required — the Dashboard branch list is the authoritative view.

---

## Cross-References

- `docs/05_operations/DB_MIGRATION_WORKFLOW.md` — migration workflow (UTV2-856)
- `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` — environment and operator policy (UTV2-858)
- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md` — connection strategy and credentials
- `docs/05_operations/REQUIRED_SECRETS.md` — secrets inventory
- `docs/06_status/proof/UTV2-855/phase9-manual-schema-reconciliation-plan.md` — current migration queue
