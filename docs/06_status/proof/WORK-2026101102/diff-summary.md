# Diff summary — WORK-2026101102

Bounded amendment to Proof Coverage Guard (`.github/workflows/proof-coverage-guard.yml`, +13 lines). After sensitive paths are computed, the exact migration `supabase/migrations/20261010170000_ncaaf_participant_catalog.sql` is removed from the sensitive set only when `packages/db/src/canonical-reference-schema.test.ts` is also in the change set. Both are fixed literals; nothing is derived from PR input. Every other migration and sensitive path keeps the unchanged accepted-proof patterns. No generic `packages/db` test glob is added.

Also: `docs/05_operations/REQUIRED_CI_CHECKS.md` documents the bounded classification (+1 line; advisory status and branch protection unchanged); new `scripts/ci/proof-coverage-guard.test.ts` (8 tests) runs the real workflow step bodies in bash; `package.json` appends only that test to `test:ops`.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1737
