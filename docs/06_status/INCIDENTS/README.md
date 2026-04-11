# Incident Log

Canonical, append-only record of production, live-DB, schema-drift, and governance-control incidents in Unit Talk V2.

## Purpose

This log exists so that:

- every live-system failure, schema-drift discovery, or governance-control breach has a durable record that outlives Linear issue state
- post-fix corrective PRs are anchored to a named incident, not only to the Linear issue that shipped the fix
- prevention/lesson rules that emerge from incidents are discoverable in one place rather than being scattered across commit messages
- recurrence is easier to spot — an entry here is a stronger signal than "I remember something like this last month"

## Authority Placement

This log lives under `docs/06_status/INCIDENTS/` and is registered in the docs authority map (`docs/05_operations/docs_authority_map.md`) under **Tier 5 — Current Status** as operational history. It is status/record-of-truth, not a contract. Contracts still live in Tier 2 and Tier 4.

Conflict rules from the authority map apply unchanged: Tier 5 never overrides Tier 2 or Tier 3. An incident entry documents what happened — it does not redefine a contract. If an incident produces a contract change, the contract change lands in its own Tier 2/4 doc and the incident entry links to it.

## Scope — when an incident entry is required

A new incident entry MUST be created when the corrective work stems from any of:

1. a live-production failure (worker down, distribution halted, wrong routing, duplicate delivery, etc.)
2. a live-database failure (constraint violation hit in prod, stranded rows, broken state-machine transition against live Postgres)
3. a schema-drift discovery (runtime expects a column/constraint/enum value that the migrated schema does not match, or vice versa)
4. a governance-control breach (a brake, gate, or authority rule that did not actually block the thing it was supposed to block against live truth)

Entries are NOT required for routine bug fixes, in-flight feature work, test-only failures, or InMemory-only discrepancies unless those escalated into one of the four categories above.

## Append-Only Spirit

Incident entries are historical records. They are additive. Corrections to an existing entry are made by:

- adding a dated **Correction** or **Update** section at the bottom of the entry, or
- opening a follow-up entry that links back to the original

Do not silently rewrite facts, timestamps, root cause wording, or remediation text after the entry has been merged. If the record was wrong, say so in an additive block.

## How to Add a New Incident

1. Copy `_TEMPLATE.md` to a new file named `INC-YYYY-MM-DD-<slug>.md`, where:
   - `YYYY-MM-DD` is the date the incident was **detected** (not the date of the fix)
   - `<slug>` is a short kebab-case description that includes the primary Linear issue ID when available, e.g. `utv2-519-awaiting-approval-constraint-gap`
2. Fill in every section of the template. If a section does not apply, write `n/a` with a one-line reason — do not delete sections.
3. Add a row to the **Index** table below, sorted newest first.
4. Link the entry from the corrective Linear issue and from the PR description.

## Index

| ID | Date Detected | Severity | Title | Primary Linear | Status |
|---|---|---|---|---|---|
| [INC-2026-04-10-utv2-519](./INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap.md) | 2026-04-10 | High | `awaiting_approval` lifecycle CHECK constraint gap + non-atomic transition | [UTV2-519](https://linear.app/unit-talk-v2/issue/UTV2-519/) | Resolved |
