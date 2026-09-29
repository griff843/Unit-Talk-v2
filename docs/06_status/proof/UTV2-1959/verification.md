# PROOF: UTV2-1959

MERGE_SHA: pending merge

VERIFIED_SOURCE_SHA: f03e0ce0b73f011584f122bce87fe35b1e0dc20a

Result: static_pass_live_db_deferred_to_ci

The recovered preflight token can carry
`t1_live_db_precondition: deferred_to_ci` only when the immutable lane-manifest
blob from the unique lane-start introduction commit carries that exact value.
The editable current manifest is comparison input, never an authority source.
Ordinary recovery omits the field, and missing, ambiguous, incomplete,
unreachable, or mismatched immutable evidence stops before token
reconstruction.

## ASSERTIONS:

- [x] Recovery derives the deferral from immutable prior lane-start evidence.
- [x] An edited current manifest cannot manufacture a deferral.
- [x] Missing, ambiguous, incomplete, unreachable, or mismatched provenance fails closed.
- [x] Shallow history is deepened before evidence resolution or recovery refuses.
- [x] The existing ownership, PR-head, dependency, cleanliness, and scope-lock checks still pass first.
- [x] Ordinary recovery cannot delete or manufacture a historical deferral.
- [ ] Writable live-DB verification is completed by staging CI against project `xskgrzbteyqdufktjrjx`.

## EVIDENCE:

```text
focused_suite: PASS (23 passed, 0 failed)
immutable_source_commit: edbbfd143f21ea18d4f45a759ad7464bd2102f2b
immutable_deferral: deferred_to_ci
static_gate: PASS
r_level_audit: PASS
proof_binding: PASS
runtime_verifier_source: f03e0ce0b73f011584f122bce87fe35b1e0dc20a
local_writable_db_access: REFUSED_BEFORE_DB_ACCESS
staging_ci_obligation: REQUIRED
```

- Focused recovery suite: 23 tests passed, 0 failed.
- Real repository resolution: source commit `edbbfd143f21ea18d4f45a759ad7464bd2102f2b`, deferral `deferred_to_ci`.
- Static repository gate: PASS.
- R-level path audit: PASS with no matching rules.
- Versioned evidence binding: PASS with the evidence commit and current PR head resolved from Git.
- Runtime-verifier gate: bound to refreshed substantive SHA `f03e0ce0b73f011584f122bce87fe35b1e0dc20a`.
- Writable DB access: refused before database access and retained as `deferred_to_ci`.

## Verification

- `pnpm verify:static` — PASS. Environment, lint, type-check, build, aggregate tests, Smart Form smoke, and command smoke completed successfully.
- `pnpm exec tsx --test scripts/ops/lane-link-pr.test.ts` — PASS: 23 tests, 23 passed, 0 failed.
- Real-history resolver invocation — PASS: uniquely resolved `edbbfd143f21ea18d4f45a759ad7464bd2102f2b` and read `deferred_to_ci` from that blob.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS: no R-level rules matched the changed paths.
- `pnpm test:db` — deferred before database access. The local URL resolved to `host=127.0.0.1`, whose project ref is unidentified; writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- `pnpm verify` — every static stage passed, then the aggregate exited only when `test:live-db` reached the same staging-identity refusal. No writable live-DB pass or waiver is claimed.

Required closeout status: Writable live-DB proof is blocked/deferred: target
identity could not be resolved from its URL (host=unparseable). Writable DB
verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci`
GitHub environment with `CI_SUPABASE_*` credentials. The measured local guard
output identified the URL host as `127.0.0.1` and the project ref as
`unidentified` before refusing access.

The immutable lane-start evidence, current manifest, and reconstructed token
must remain in agreement. The deferred obligation survives recovery and still
requires a genuine G6 staging-CI receipt.

## Merge SHA Binding

Verified source SHA: `f03e0ce0b73f011584f122bce87fe35b1e0dc20a`

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1700
Execution SHA: f03e0ce0b73f011584f122bce87fe35b1e0dc20a
