# Diff summary: UTV2-1971

The lane adds the frozen 2026 NCAA Division I football catalog to the canonical
`participants` table. It contains 266 school-qualified rows (138 FBS, 128 FCS),
deterministic UUIDv5 identities, additive conflict refusal, and a reference-safe
rollback. It does not write `teams` or change runtime/provider/delivery behavior.

| File | Change |
|---|---|
| `supabase/migrations/20261010170000_ncaaf_participant_catalog.sql` | Additive, idempotent participant seed with identity-conflict guards. |
| `db/migrations-rollback/20261010170000_ncaaf_participant_catalog.down.sql` | Deletes only UTV2-1971-owned rows and refuses when any FK references them. |
| `packages/db/src/ncaaf-participant-roster.json` | Reviewed NCAA directory fixture and membership reconciliation. |
| `packages/db/src/canonical-reference-schema.test.ts` | Fixture, identity, SQL-scope, and concurrent rollback tests. |
| `docs/06_status/proof/UTV2-1971/*` | Issue-owned governed review evidence. |

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: `82106a80506cc6204c4fa958f684ae69017d48bf`
