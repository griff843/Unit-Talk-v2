# AGENTS.md - Unit Talk V2

## Workspace Intent

- Active greenfield workspace: `C:\dev\unit-talk-v2`
- Legacy reference workspace: `C:\dev\unit-talk-production`
- Legacy repo is read-only unless a user explicitly requests extraction or migration support work.

## Build Rules

- This repo is the execution surface for `unit-talk-v2`.
- Reuse from the legacy repo must be deliberate, documented, and adapted to the new contracts.
- Canonical docs live only under:
  - `docs/01_principles`
  - `docs/02_architecture`
  - `docs/03_product`
  - `docs/04_roadmap`
  - `docs/05_operations`
  - `docs/06_status`

## Current Bootstrap Goal

- Establish a clean monorepo foundation for the current app and package surfaces.

## Operating Assumptions

- API is the only intended canonical business-table writer.
- Smart Form submits through an intake bridge rather than direct canonical writes.
- Operator surfaces are read-oriented unless a future contract explicitly grants controlled write authority.

## Documentation Truth Policy

When reviewing or editing architecture, contract, roadmap, or matrix documents:

- Never present a consumer as active unless code-level evidence exists.
- Classify every listed consumer as exactly one of:
  - `ACTIVE`
  - `NOT_CONSUMING`
- Reject words that imply proximity without proof, including:
  - adjacent
  - easy to wire
  - possible
  - ready to consume
- For every ACTIVE consumer claim, provide:
  - exact file path
  - exact symbol or usage reference
- If a document mixes proven and aspirational consumers without explicit status markers, treat it as drift and fail review.

### V1 Gate Enforcement (Domain Analysis Only)

The automated PR gate (`doc-truth-gate.yml`) enforces this policy for `metadata.domainAnalysis` consumer claims only. V1 governed docs:
- `docs/02_architecture/week_19_downstream_consumer_matrix.md`
- `docs/03_contracts/domain_analysis_consumer_contract.md`

The gate verifies ACTIVE claims against domain-analysis evidence tokens in the codebase and rejects banned speculative wording. It does not yet verify consumer claims for other data surfaces (settlement, lifecycle, promotion). The classification rules above apply to all docs as a human-enforced policy; only the two listed docs have automated gate enforcement.
