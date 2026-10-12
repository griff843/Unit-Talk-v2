# Diff summary: UTV2-1972

This migration lane adds the 15 active 2026 WNBA franchises to the canonical
`participants` table. The catalog uses deterministic UUIDv5 identities,
additive conflict refusal, and a reference-safe rollback. Runtime Smart Form
validation/FK changes were separated from this lane after staging diagnosis.
This lane does not write `teams`, invent provider IDs, ingest provider data, or
activate modeling, grading, promotion, or delivery behavior.

| File | Change |
|---|---|
| `supabase/migrations/20261010170100_wnba_participant_catalog.sql` | Adds the WNBA sport and league, mirrors existing NBA basketball availability, and idempotently seeds 15 canonical participants. |
| `db/migrations-rollback/20261010170100_wnba_participant_catalog.down.sql` | Deletes only UTV2-1972-owned participants and refuses when any FK references them. |
| `packages/db/src/canonical-reference-schema.test.ts` | Covers the canonical WNBA SQL invariants and scratch migration behavior. |
| `docs/06_status/proof/UTV2-1972/*` | Issue-owned governed review evidence. |

## Catalog containment

- Included: Atlanta Dream, Chicago Sky, Connecticut Sun, Dallas Wings, Golden
  State Valkyries, Indiana Fever, Las Vegas Aces, Los Angeles Sparks, Minnesota
  Lynx, New York Liberty, Phoenix Mercury, Portland Fire, Seattle Storm,
  Toronto Tempo, and Washington Mystics.
- Excluded: Cleveland Sirens (announced for 2028, not active in 2026).
- Canonical table written: `public.participants` only for franchise identities.
- Explicitly untouched: `public.teams` and provider-identity tables.

## SHA Binding

Merge SHA: pending merge
PR: #1745
Verified implementation SHA: `f99394febd9fff60c80044ae1f4ec688eeaf9d3d`
