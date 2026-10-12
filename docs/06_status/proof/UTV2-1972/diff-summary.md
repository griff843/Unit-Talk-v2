# Diff summary: UTV2-1972

This lane adds the 15 active 2026 WNBA franchises to the canonical
`participants` table and enables manual-human WNBA Smart Form submissions. The
catalog uses deterministic UUIDv5 identities, additive conflict refusal, and a
reference-safe rollback. It does not write `teams`, invent provider IDs, ingest
provider data, or activate modeling, grading, promotion, or delivery behavior.

| File | Change |
|---|---|
| `supabase/migrations/20261010170100_wnba_participant_catalog.sql` | Adds the WNBA sport and league, mirrors existing NBA basketball availability, and idempotently seeds 15 canonical participants. |
| `db/migrations-rollback/20261010170100_wnba_participant_catalog.down.sql` | Deletes only UTV2-1972-owned participants and refuses when any FK references them. |
| `packages/contracts/src/reference-data.ts` | Publishes WNBA with existing basketball markets/stats and no legacy teams catalog. |
| `apps/api/src/smart-form-validation.ts` | Treats WNBA as a team sport for API submission validation. |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Treats WNBA as a team sport in the manual submission UI. |
| `apps/smart-form/lib/form-utils.ts` | Applies the client-side WNBA team requirement. |
| `packages/db/src/pick-foreign-keys.ts` | Normalizes manual-human WNBA picks to the basketball sport FK while leaving generic API/system WNBA picks unsupported. |
| Focused test files | Cover the catalog response, API/UI guards, canonical SQL invariants, and FK normalization. |
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
Verified implementation SHA: `f9a6b538c6b2f76cde1f474ebfbb1075ab012a87`
