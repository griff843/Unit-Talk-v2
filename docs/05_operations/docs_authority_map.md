# Docs Authority Map

This file defines how Unit Talk V2 documentation is ranked, what is current authority, and what is historical evidence only.

## Metadata

| Field        | Value                            |
| ------------ | -------------------------------- |
| Owner        | Program Owner                    |
| Status       | Ratified                         |
| Ratified     | 2026-03-20                       |
| Last Updated | 2026-05-18 docs convergence pass |

## Truth Rules

Docs are authority for contracts, policies, and historical proof. Docs are not automatically proof that the runtime is currently healthy.

When current state is disputed, use this order:

1. Live systems: Linear for issue state, GitHub for PR/check state, and runtime commands such as `pnpm runtime:health`, `pnpm pipeline:health`, and `pnpm readiness:report`.
2. Repo execution truth: lane manifests in `docs/06_status/lanes/*.json`, filtered to active statuses only.
3. Current status views: `docs/06_status/PROGRAM_STATUS.md` and `docs/06_status/SYSTEM_STATE.md`.
4. Historical records: `ISSUE_QUEUE.md`, closed proof bundles, dated audits, archived phase evidence, and superseded schemas.

If a status doc says something is green but a live command fails, the live command wins until the status doc is regenerated.

## Tier 1 - Principles

| File                                    | Purpose                                      | Owner         |
| --------------------------------------- | -------------------------------------------- | ------------- |
| `docs/01_principles/rebuild_charter.md` | Why V2 exists and non-negotiable constraints | Program Owner |
| `docs/01_principles/system_context.md`  | Runtime systems and control boundaries       | Program Owner |

## Tier 2 - Architecture Contracts

| File                                    | Purpose                                                                                   | Owner                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `docs/02_architecture/domain_model.md`  | Core entities and flows                                                                   | Architecture            |
| `docs/02_architecture/rebuild_scope.md` | What is in and out of V2 scope                                                            | Architecture            |
| `docs/02_architecture/contracts/*.md`   | Runtime, lifecycle, settlement, distribution, environment, and writer-authority contracts | Architecture / Platform |
| `docs/02_architecture/SCHEMA_FACTS.md`  | Current schema facts and gotchas                                                          | Architecture            |

## Tier 3 - Product Contracts

| File                                              | Purpose                                       | Owner        |
| ------------------------------------------------- | --------------------------------------------- | ------------ |
| `docs/03_product/PLATFORM_SURFACES_AUTHORITY.md`  | Primary platform surface registry             | Product      |
| `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md` | Primary member tier and role access authority | Product      |
| `docs/03_product/DISCORD_COMMAND_CATALOG.md`      | Live Discord command registry                 | Product      |
| `docs/03_product/*CONTRACT.md`                    | Product-surface contracts                     | Product      |
| `docs/discord/*.md`                               | Discord message, embed, and cadence contracts | Product      |
| `docs/03_contracts/*.md`                          | Domain consumer contracts                     | Architecture |

Removed historical product files are intentionally absent from this checkout. Do not cite old filenames such as `program_surfaces.md`, `ROLE_ACCESS_MATRIX.md`, or `command_center_truth_surface_prd.md` as active references.

## Tier 4 - Operational Docs

| File                                                                                                  | Purpose                                                                                                | Owner         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| `docs/05_operations/AGENT_OPERATING_MODEL.md`                                                         | Active agent operating model                                                                           | Program Owner |
| `docs/05_operations/DELEGATION_POLICY.md`                                                             | Delegation and sensitive-path policy                                                                   | Program Owner |
| `docs/05_operations/LANE_MANIFEST_SPEC.md`                                                            | Lane manifest lifecycle and schema                                                                     | Program Owner |
| `docs/05_operations/TRUTH_CHECK_SPEC.md`                                                              | Truth-check gate contract                                                                              | Program Owner |
| `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`                                                      | Canonical full evidence-bundle template                                                                | Program Owner |
| `docs/05_operations/R1_R5_OPERATING_RULE.md` and `docs/05_operations/r1-r5-rules.json`                | R-level verification rules                                                                             | Program Owner |
| `docs/05_operations/DB_*.md` and `docs/05_operations/SUPABASE_*.md`                                   | Database operation, migration, rollback, and Supabase policy                                           | Platform      |
| `docs/05_operations/*CONTRACT.md`, `docs/05_operations/*STANDARD.md`, `docs/05_operations/*POLICY.md` | Active operational contracts and standards unless explicitly marked historical inside the file         | Owning lane   |
| `docs/05_operations/lane-manager.md`                                                                  | Retired. Superseded by `LANE_MANIFEST_SPEC.md`; retained only because older references still exist.    | Historical    |
| `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md`                                                    | Historical queue design. Linear and lane manifests supersede `ISSUE_QUEUE.md` as live execution truth. | Historical    |
| `docs/archive/GOVERNED_LOOP_SPEC.md`                                                                  | Archived. Governed loop is in production; spec is now implementation history.                          | Archived      |
| `docs/archive/CODEX_*_INTEGRATION_SPEC.md`                                                            | Archived. Codex integration is implemented; specs are implementation history.                          | Archived      |
| `docs/archive/codex_wave_execution_playbook.md`                                                       | Archived. Wave execution model is implemented; playbook is historical reference.                       | Archived      |

## Tier 5 - Current Status And Evidence

| File                                    | Purpose                                                                                                                                               | Authority Within Tier |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `docs/06_status/PROGRAM_STATUS.md`      | High-level program status at its stated update time                                                                                                   | Primary status view   |
| `docs/06_status/SYSTEM_STATE.md`        | Volatile generated/current checkout snapshot                                                                                                          | Current snapshot      |
| `docs/06_status/lanes/*.json`           | Repo-local lane manifests. Active state is determined by filtering to active statuses only; closed/done/merged files are historical records in place. | Execution truth       |
| `docs/06_status/proof/**`               | Proof and evidence archive. Current only when referenced by an active lane, PR, or recent closeout.                                                   | Evidence archive      |
| `docs/06_status/KNOWN_DEBT.md`          | Known-debt pointer index                                                                                                                              | Debt index            |
| `docs/06_status/INCIDENTS/**`           | Incident history                                                                                                                                      | Operational history   |
| `docs/06_status/ISSUE_QUEUE.md`         | Deprecated historical work queue. Linear is live execution state.                                                                                     | Historical only       |
| `docs/06_status/PROOF_BUNDLE_SCHEMA.md` | Superseded proof schema. New bundles use `EVIDENCE_BUNDLE_TEMPLATE.md`.                                                                               | Historical only       |
| `docs/06_status/PROOF_TEMPLATE.md`      | Historical T1 proof template. New simple proofs use `docs/06_status/proof/PROOF-TEMPLATE.md`; full bundles use `EVIDENCE_BUNDLE_TEMPLATE.md`.         | Historical template   |
| Dated audits and phase evidence bundles | Historical evidence snapshots                                                                                                                         | Historical only       |

## Conflict Rules

1. Tier 5 never overrides Tier 2 or Tier 3.
2. Operational docs must not contradict principles, contracts, or product identity.
3. `PROGRAM_STATUS.md` is not runtime proof; live runtime commands win.
4. Linear is authoritative for current issue state. GitHub is authoritative for PR/check state.
5. Lane manifests are the repo-local execution record. Closed/done/merged manifests are history, not active work.
6. `ISSUE_QUEUE.md` is historical only.
7. Closed proof bundles, dated audits, and phase evidence do not prove current runtime health.
8. Legacy repo references never override V2 docs; see `docs/05_operations/legacy_repo_reference_boundary.md`.

## Doc Lifecycle

| State      | Meaning                                        |
| ---------- | ---------------------------------------------- |
| Draft      | Not ratified; not binding                      |
| Ratified   | Authoritative; changes require owner approval  |
| Deprecated | Superseded; kept with successor link           |
| Archived   | Historical only; not a current source of truth |
