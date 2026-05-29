# UTV2-1192 Diff Summary

## Summary

- Updated `scripts/ops/proof-check.ts` to resolve nested historical proof evidence at `docs/06_status/proof/<issue>/evidence.json`.
- Added legacy evidence handling so schema v1 historical bundles can satisfy post-merge `merge_sha` checks without being rejected by schema v2 validation.
- Bound the historical UTV2-1020 evidence bundle to merge SHA `e7d3216f3e093cc4a9e4b16cae89182f0afc05af`.

## Scope

- No runtime delivery, domain, database schema, migration, or app behavior changed.
- Historical proof repair only: `docs/06_status/proof/UTV2-1020/evidence.json` and `scripts/ops/proof-check.ts`.

## Issue-Specific Check

`pnpm ops:proof-check UTV2-1020 --post-merge` now resolves `docs/06_status/proof/UTV2-1020/evidence.json`, validates the historical merge SHA, and returns PASS.

## SHA Binding
merge_sha: 6248a6845c1fd283d1677e5471554399cceea163
