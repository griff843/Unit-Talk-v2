# PROOF: UTV2-1291 Diff Summary
MERGE_SHA: 4ea34d255a2e476fe5aa2fd9ac8ba79b75fe2d70

## Summary

- Added `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_PROPOSAL.md`.
- Documented the current `pnpm verify` / `pnpm test` / `test:t1-proof` live-DB pressure path.
- Proposed a split between static/local verification and serialized live-DB proof that preserves T1 runtime proof while preventing docs-only and T3 lanes from amplifying Supabase degradation.

## Files Changed

- `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_PROPOSAL.md` - new governance proposal and audit findings for isolating live-DB verification pressure.

## Scope Notes

- No workflow files changed.
- No runtime code changed.
- No database schema, migration, or generated DB type files changed.
- Proof files under `docs/06_status/proof/UTV2-1291/` are lane closeout artifacts declared in `docs/06_status/lanes/UTV2-1291.json`.
