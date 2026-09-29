# PROOF: UTV2-1959

MERGE_SHA: pending merge

VERIFIED_SOURCE_SHA: 5072855a4387ae7e82a0be610a7c3319d96371cd

Result: static_pass_live_db_deferred_to_ci

The recovered preflight token and the authoritative active T1 manifest both
carry `t1_live_db_precondition: deferred_to_ci`. Ordinary recovery omits the
field, and the pre-existing ownership, PR-head, dependency, cleanliness, and
scope-lock failures still stop before token reconstruction.

## Assertions

- [x] Recovery preserves the manifest-bound deferral exactly.
- [x] The copy occurs only after the existing fail-closed checks pass.
- [x] Ordinary recovery does not manufacture a deferral.
- [x] Existing fail-closed recovery tests remain green.
- [ ] Writable live-DB verification is completed by staging CI against project `xskgrzbteyqdufktjrjx`.

## Verification

- `pnpm verify:static` — PASS. Environment, lint, type-check, build, aggregate tests, Smart Form smoke, and command smoke completed successfully.
- `pnpm exec tsx --test scripts/ops/lane-link-pr.test.ts` — PASS: 20 tests, 20 passed, 0 failed.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS: no R-level rules matched the changed paths.
- `pnpm test:db` — deferred before database access. The local URL resolved to `host=127.0.0.1`, whose project ref is unidentified; writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- `pnpm verify` — every static stage passed, then the aggregate exited only when `test:live-db` reached the same staging-identity refusal. No writable live-DB pass or waiver is claimed.

Required closeout status: Writable live-DB proof is blocked/deferred: target
identity could not be resolved from its URL (host=unparseable). Writable DB
verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci`
GitHub environment with `CI_SUPABASE_*` credentials. The measured local guard
output identified the URL host as `127.0.0.1` and the project ref as
`unidentified` before refusing access.

The manifest and reconstructed token remain in agreement; the deferred
obligation survives recovery and still requires a genuine G6 staging-CI
receipt.

## Merge SHA Binding

Verified source SHA: `5072855a4387ae7e82a0be610a7c3319d96371cd`

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1700
