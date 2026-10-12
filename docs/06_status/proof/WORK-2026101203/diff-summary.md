# Diff summary: WORK-2026101203

This lane adds WNBA as a governed first-class reference sport using the existing
NCAAF participant-catalog path. It seeds one sport, one league, 22 team-market
availability rows, and the 15 current 2026 franchises with deterministic UUIDv5
identities and fail-closed conflict semantics. It does not change Smart Form,
API, provider, delivery, or runtime-switch behavior.

| File | Change |
|---|---|
| `supabase/migrations/20261012180000_wnba_reference_catalog.sql` | Additive, idempotent WNBA sport, league, market-availability, and participant seed. |
| `db/migrations-rollback/20261012180000_wnba_reference_catalog.down.sql` | Locks governed identities, refuses downstream references, and removes only exact catalog rows. |
| `packages/db/src/wnba-participant-roster.json` | Freezes official WNBA roster sources, current-franchise reconciliation, and future expansion exclusions. |
| `packages/db/src/canonical-reference-schema.test.ts` | Adds WNBA source, identity, idempotency, refusal, preservation, and round-trip coverage without changing the NCAAF cases. |
| `packages/db/src/scripts/work-2026101203-wnba-reference-catalog-proof.ts` | Adds an on-demand writable proof that refuses every target except governed staging. |
| `docs/06_status/proof/WORK-2026101203/*` | Governed review evidence and executor model-routing receipt. |

## SHA Binding

Merge SHA: pending merge
PR: #1744
Execution SHA: `7791bcbaf9e0fa8e6ea3df43726b6ed4cc733fd6`
