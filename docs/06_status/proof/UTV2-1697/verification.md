# PROOF: UTV2-1697

MERGE_SHA: b092c93c0b52d7b3543ab848a8b901c45caf61fe

Verified implementation SHA: `b092c93c0b52d7b3543ab848a8b901c45caf61fe`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. Post-merge closeout binds it to the authoritative merge SHA.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ci/capability-map-check.test.ts'` | PASS | 5 tests passed; 0 failed |
| Exact UTV2-1693 map payload | PASS | 22 entries checked; 0 findings |
| `pnpm type-check` | PASS | TypeScript project-reference check completed with exit code 0 |
| `pnpm test` | Pending static gate | Executed as part of `pnpm verify:static` |
| `pnpm verify:static` | Pending at proof write | Repository-wide static gate is running; final result is recorded before PR submission |

## Issue-specific assertions

- A missing map or invalid JSON fails instead of silently treating the map as valid.
- Every entry requires a supported schema version, declared authority level, unique non-empty situation, primary capability, kind, and fallback/null value.
- Command references resolve to root package scripts; agent and skill references resolve to the respective `.claude` Markdown surfaces.
- Fallbacks resolve to any supported capability surface, preserving the map’s declared fallback contract.
- The CI workflow is path-scoped and checks the committed map after UTV2-1693 supplies it; before that dependency lands, it still runs this checker’s regression tests and issues a visible skip notice.

## Database verification

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

This T2 lane changes repository governance tooling only and performs no database writes.
