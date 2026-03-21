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
