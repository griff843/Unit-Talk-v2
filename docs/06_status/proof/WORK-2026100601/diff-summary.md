# Diff summary: WORK-2026100601

| File | Change |
|---|---|
| `scripts/ops/merged-lane-recovery.ts` | Adds explicit recovery request parsing, fresh GitHub/origin-main attestation, fail-closed evidence evaluation, stable dual-attestation binding, source-only overlap filtering, and a durable provenance receipt. |
| `scripts/ops/preflight.ts` | Admits only T1 governance recovery requests with a separately identified lane and fresh attestation; preserves every ordinary ownership check except the exact attested source overlap. |
| `scripts/ops/lane-start.ts` | Re-attests independently, keeps the source lane in concurrency accounting, validates the preflight binding, and records the original lane/PR/merge/run/authority relationship. |
| `scripts/ops/preflight.test.ts` | Covers exact positive admission and deterministic refusals for ordinary, missing, mismatched, stale, successful, unrelated, unavailable, negated, revoked, quoted, and example-text evidence. |
| `scripts/ops/lane-start.test.ts` | Covers stable binding, source-only overlap isolation, capacity retention, and durable provenance receipt contents. |
| Lane work/sync/manifest and this proof directory | Records bounded authority, measured verification, staging deferral, executor provenance, and PR handoff. |

No product, Discord, settlement, scoring, grading, routing, provider, activation,
schema, contract, domain, migration, or runtime-delivery behavior changed. PRs
#1715 and #1714 and production Shadow remain on hold. Existing C6 runtime proof
was neither regenerated nor represented as new evidence.

## SHA Binding

Implementation SHA: `6cf66a1af0494321e9a2e740d4cc17760147390f`

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1719
