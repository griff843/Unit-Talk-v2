# Legacy Repo Reference Boundary

## Purpose

Define the exact role of `C:\dev\unit-talk-production` during the V2 rebuild.

## Rule

`C:\dev\unit-talk-production` is reference-only.

It may be used for:
- legacy channel IDs
- legacy formatting examples
- migration discovery
- parity questions
- historical behavior lookup

It may not be used as implicit authority for V2.

## V2 Authority Order

When legacy behavior conflicts with V2, the V2 repo wins in this order:

1. `docs/01_principles/*`
2. `docs/02_architecture/contracts/*`
3. `docs/03_product/*`
4. `docs/05_operations/*`
5. `docs/06_status/status_source_of_truth.md`
6. runtime proof from `unit-talk-v2`

## Required Handling

- If legacy parity becomes relevant, write a short reference note into `unit-talk-v2`.
- Do not rely on chat memory as the carrier for legacy knowledge.
- Do not port legacy behavior into V2 without a contract or product decision.
- Do not treat legacy env/config/runtime state as proof for V2.

## Non-Authority Examples

The legacy repo cannot by itself:
- approve a new routing target
- override a V2 contract
- justify a V2 schema change
- justify a live rollout decision
- justify skipping proof capture

## Current Use

The legacy repo has already been used for:
- Discord target ID verification
- message-format inspiration
- routing taxonomy lookup

Those values are authoritative in V2 only after being written into V2 docs.
