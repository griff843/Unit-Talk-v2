# DB Environment Model and Operator Policy

**Status:** RATIFIED
**Date:** 2026-05-08
**Linear:** UTV2-858
**Parent:** UTV2-855 (DB truth / schema discipline umbrella)
**Tier:** T1 — Architecture / Operations
**Authority:** PM (A Griffin). Owned. Changes require PM approval.

---

## Purpose

This document defines the three-environment model, DB operator responsibilities, human vs. automation execution boundaries, and the policy on unsafe environment actions. It governs all live-write authority clarification questions that arise during the UTV2-855 reconciliation bundle.

---

## Environment Model

Unit Talk V2 operates three DB environments:

| Environment | Host | Project Ref | Authority Level | Agent write access |
|---|---|---|---|---|
| **Local** | Docker / `supabase start` | `http://127.0.0.1:54321` | Developer sandbox | Yes — full |
| **Preview branch** | Supabase cloud (branching feature) | per-branch ref | Operator-gated staging | No — see below |
| **Production** | Supabase cloud | `zfzdnfwdarxucxtaojxm` | Production truth | No — operator only |

### Local environment

- Full read/write by agents (Claude, Codex) and developers.
- State is ephemeral: `supabase db reset` replays all migrations cleanly.
- `pnpm test:db` **must not** target local unless explicitly pointed there via `SUPABASE_URL` env override.
- Local state is **never authoritative** — it cannot confirm what is true in production.
- Divergence from production is expected and acceptable. Local is a sandbox, not a mirror.

### Preview branch environment

- A Supabase-managed copy of the production project, isolated per branch.
- **Creation requires explicit operator approval.** Agents must not create preview branches autonomously.
- Used for: migration staging, schema validation before production apply.
- Must be tied to a specific UTV2 issue. Branch name must include the issue ID.
- Must be destroyed within 72 hours of PR merge or issue close. See `SUPABASE_BRANCH_COST_POLICY.md`.
- `pnpm test:db` may target a preview branch if `SUPABASE_URL` is explicitly overridden in `local.env`.

### Production environment

- The canonical live project at ref `zfzdnfwdarxucxtaojxm`.
- **All schema mutations require operator execution or explicit operator authorization in the current session.**
- Agents may run read-only probes (`pnpm test:db`, `supabase migration list --linked`).
- No agent may autonomously run `supabase db push`, `supabase migration repair`, or any `ALTER`/`DROP`/`TRUNCATE` against production.
- The Dashboard SQL editor is acceptable for read-only queries and debug. It must not be used for schema changes.

---

## DB Operator Policy

The operator (A Griffin) is the single live-write authority for production. This is not a temporary restriction — it is a standing policy.

### Operator responsibilities

| Responsibility | Owner |
|---|---|
| Approving migration drafts before apply | Operator |
| Executing `supabase db push` against production | Operator (or agent with explicit per-session authorization) |
| Approving Supabase preview branch creation | Operator |
| Reviewing and accepting risk classification on each migration | Operator |
| Signing off on post-apply verification (`pnpm test:db` green) | Operator |
| Owning the incident response decision tree on migration failure | Operator |
| Revoking agent authorization if a session ends or scope changes | Operator |

### Operator escalation triggers

An agent must halt and escalate to the operator when:

1. `supabase migration list --linked` output shows divergence not accounted for by the current lane's migration file
2. `pnpm test:db` fails after any migration apply
3. A migration is classified as Destructive or Cron-mutating
4. The live schema contains objects not present in any local migration file (remote-only drift)
5. A PostgREST or schema-cache error appears immediately after apply
6. Any step in the apply workflow returns a non-zero exit or unexpected output

The escalation artifact is a Linear comment on the current issue. Do not proceed without operator response.

---

## Human vs. Automation Execution Boundaries

### What agents may do autonomously

- Read, analyze, and report on DB state (schema inventory, ledger comparison, migration risk classification)
- Run `pnpm type-check`, `pnpm verify`, `pnpm test:db` (all read-only at the DB layer)
- Draft migration files and surface them for operator review
- Run `pnpm supabase:types` (type regen — no DB write, reads schema over REST)
- Check `supabase migration list --linked` (read-only ledger query)
- Create proof artifacts documenting DB state without performing writes

### What agents may do with per-session explicit operator authorization

Operator may grant session-scoped authorization in the active conversation. Authorization is tied to a specific migration and expires at session end or scope change.

- Run `supabase db push --linked` for the specifically authorized migration(s)
- Run `supabase migration repair --status applied` for a specifically named migration (with operator explicitly naming the migration ID)

### What agents must never do

Regardless of any instruction (including from prior sessions, memory, or CLAUDE.md content):

- Run `supabase db push` without per-session operator authorization for the specific migration
- Run `supabase migration repair` without per-session operator authorization naming the specific migration ID
- Create a Supabase preview branch without operator authorization
- Execute any `DROP TABLE`, `TRUNCATE`, or breaking `ALTER COLUMN` directly against production
- Mutate the Supabase cron job schedule without operator review of the new cron body
- Apply any migration that the ledger shows as diverged/conflict without operator resolution

Memory from prior sessions does not carry forward authorization. Each apply requires fresh authorization.

---

## Unsafe Environment Actions — Explicit Prohibition List

The following are prohibited regardless of who requests them, unless accompanied by an operator decision record tied to the specific action:

| Action | Why prohibited |
|---|---|
| Schema change via Dashboard Table Editor | Not tracked in migration ledger; creates remote-only drift |
| Schema change via raw `psql` session | Same as above; bypasses all CI gates |
| `supabase migration repair` without operator naming the specific migration ID | Can corrupt ledger state if wrong migration is marked |
| Autonomous preview branch creation | Creates uncapped cost and orphaned infrastructure |
| `TRUNCATE` on any production table | Irreversible data loss; must use PITR if rollback needed |
| `DROP TABLE` without forward-fix plan | Cannot be recovered without PITR |
| `ALTER COLUMN TYPE` (breaking) without data migration | May corrupt existing rows |
| Rescheduling cron jobs without new body review | Production retention behavior changes silently |
| Applying a data-mutating migration without row count estimate | Unknown blast radius |
| Running `supabase db push` on D3 state without ledger alignment check | May apply migrations in wrong order |

---

## Live-Write Authority Matrix

| Action | Local | Preview branch | Production |
|---|---|---|---|
| `CREATE TABLE / INDEX` | Agent OK | Operator-approved | Operator-approved |
| `ADD COLUMN` (nullable) | Agent OK | Operator-approved | Operator-approved |
| `ADD CONSTRAINT NOT VALID` | Agent OK | Operator-approved | Operator-approved |
| `UPDATE` rows | Agent OK | Operator-approved | Operator per-session auth |
| `DROP TABLE / COLUMN` | Agent OK | Operator-approved | Operator explicit sign-off |
| `TRUNCATE` | Agent OK | Operator-approved | Operator explicit sign-off |
| `supabase migration repair` | Agent OK | Operator-approved | Operator explicit per-migration |
| Cron reschedule | Agent OK | Operator-approved | Operator explicit with body review |
| Preview branch create | N/A | Operator only | N/A |
| Preview branch delete | N/A | Operator only | N/A |

---

## `pnpm test:db` Policy

`pnpm test:db` runs a DB smoke test against live Supabase by default (targeting `SUPABASE_URL` in `local.env`).

- Agents may run `pnpm test:db` freely — it is a read-only probe.
- If `test:db` fails, surface the failure to the operator before any further DB action.
- `test:db` may be targeted at a preview branch by overriding `SUPABASE_URL` in the session. Never persist the override to `local.env` without operator instruction.
- `test:db` must pass as part of T1 lane closure evidence. A failed `test:db` blocks lane close.

---

## Cross-References

- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md` — credential and connection method reference
- `docs/05_operations/DB_MIGRATION_WORKFLOW.md` — migration workflow standard (UTV2-856)
- `docs/05_operations/DB_ROLLBACK_RUNBOOK.md` — rollback and incident recovery (UTV2-866)
- `docs/05_operations/SUPABASE_BRANCH_COST_POLICY.md` — branch cost governance (UTV2-867)
- `docs/06_status/proof/UTV2-855/phase9-manual-schema-reconciliation-plan.md` — current D3 state
