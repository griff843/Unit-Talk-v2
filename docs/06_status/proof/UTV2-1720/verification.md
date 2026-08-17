# PROOF: UTV2-1720

MERGE_SHA: f1eb161109286aab7d7e70300dac598a52ecf350

ASSERTIONS:

- The pre-merge binding is the exact substantive source head; post-merge automation must rebind this anchor to the authoritative merge SHA.
- Schema-v1 evidence remains readable while schema-v2 evidence uses one fail-closed, manifest-selected proof profile.
- Static governance proof does not fabricate runtime queries or row counts, and app-runtime proof remains strict.
- Schema-v2 verifier provenance comes from an external exact-head required check, never an author-written identity.

EVIDENCE:

```text
static gate: PASS
focused regression: PASS (321 tests, 0 failed, 0 skipped)
writable DB: BLOCKED_DEFERRED at the staging identity guard
shared contract: PASS
proof binding: PASS
r-level check: PASS
```

## Verification

Substantive source binding: `f1eb161109286aab7d7e70300dac598a52ecf350`.

### Static gate

`pnpm verify` ran the complete `pnpm verify:static` stage successfully, including `pnpm type-check` and `pnpm test`. It then entered `test:live-db` and stopped at the staging identity guard. The full command therefore exited 1 for the explicitly deferred infrastructure condition; this is not represented as a passing full verify.

The final literal portion of `pnpm verify` was:

```text
> @unit-talk/v2@0.1.0 test:live-db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm test:db && pnpm test:t1-proof:live


> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
```

### Writable DB proof

Command: `pnpm test:db`

The complete literal output was:

```text
> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1720-closeout-contract-repair
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE Command failed with exit code 1.
 ELIFECYCLE Command failed with exit code 1.
```

Because the staging guard exits before `tsx --test` starts, no legitimate node:test TAP trailer exists for this run. A passing trailer is deliberately not invented. Writable live-DB proof remains blocked/deferred and must run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

### Focused regression suite

Command:

```text
pnpm exec tsx --test 'scripts/ci/proof-binding-validator.test.ts' 'scripts/ops/lane-close.test.ts' 'scripts/ops/proof-auditor-gate.test.ts' 'scripts/ops/proof-schema.test.ts' 'scripts/ops/truth-check-lib.test.ts'
```

Literal excerpts covering the new contract scenarios:

```text
TAP version 13
# Subtest: binding gate consumes the shared schema-v2 migration contract
ok 1 - binding gate consumes the shared schema-v2 migration contract
# Subtest: binding gate fails schema v2 when sha_binding is absent
ok 2 - binding gate fails schema v2 when sha_binding is absent
# Subtest: binding gate keeps supported schema-v1 evidence readable
ok 3 - binding gate keeps supported schema-v1 evidence readable
# Subtest: version-aware evidence contract accepts supported schema-v1 bundles
ok 196 - version-aware evidence contract accepts supported schema-v1 bundles
# Subtest: schema-v2 migration profile accepts executed receipts without queries or row_counts
ok 197 - schema-v2 migration profile accepts executed receipts without queries or row_counts
# Subtest: schema-v2 evidence fails without valid sha_binding
ok 198 - schema-v2 evidence fails without valid sha_binding
# Subtest: app-runtime profile fails closed without queries and row_counts
ok 199 - app-runtime profile fails closed without queries and row_counts
# Subtest: schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input
ok 200 - schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input
# Subtest: schema-v2 migration T1 passes R1/R2 without fabricated queries or row_counts
ok 232 - schema-v2 migration T1 passes R1/R2 without fabricated queries or row_counts
# Subtest: schema-v2 app/runtime T1 still fails without queries and row_counts
ok 233 - schema-v2 app/runtime T1 still fails without queries and row_counts
# Subtest: schema-v2 verifier provenance is external and exact-head, never evidence-authored identity
ok 234 - schema-v2 verifier provenance is external and exact-head, never evidence-authored identity
# Subtest: schema-v2 migration packet passes pre-merge and post-merge shared contract without row counts
ok 281 - schema-v2 migration packet passes pre-merge and post-merge shared contract without row counts
# Subtest: close eligibility catches shared proof-profile disagreement before merge
ok 282 - close eligibility catches shared proof-profile disagreement before merge
1..305
# tests 321
# suites 2
# pass 321
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 14338.477494
```

### Proof and R-level checks

Shared evidence contract and proof binding:

```text
schema_version: 2
proof_profile: static (manifest lane_type: governance)
contract failures: 0
placeholder_fields_resolved: true
binding violations: 0
proof-binding-validator: PASS
```

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:

```text
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
```
