# PROOF: UTV2-1973

MERGE_SHA: pending merge

Issue: UTV2-1973<br>
Tier: T1<br>
Execution SHA: `cd23bc28724e8378d39d0da5470346518d0603f5`<br>
result: local_static_pass_staging_deferred

## Summary

The exact-path seed-proof router and its disposable-PostgreSQL lifecycle drill are complete
and statically verified. The focused runtime fixture passed locally against loopback PostgreSQL.
The required writable staging proof was attempted and refused before DB access because the local
target was not the sanctioned staging project; protected exact-head CI must supply that receipt.

## ASSERTIONS:

- [x] Only the two governed catalog migration paths enter the participant seed drill.
- [x] Other migrations retain the existing DDL refusal path.
- [x] Seed proof counts only after the drill exits successfully.
- [x] Conflict refusal is atomic and leaves the captured state unchanged.
- [x] Clean apply matches the frozen identities and repeat apply causes no row, UUID, count, or schema churn.
- [x] Rollback refuses referenced identities even through a cascading foreign key, removes only inserted identities, restores the exact baseline, and permits a stable reapply.
- [x] Existing matching canonical IDs remain byte-identical through apply, repeat, and rollback.
- [x] Writes to unrelated tables, including teams, picks, provider, delivery, and event data, are rejected by full-table snapshots.

## EVIDENCE:

Focused issue proof on disposable PostgreSQL 18.6:

```text
$ PARTICIPANT_CATALOG_TEST_ADMIN_URL=postgresql://griff843@127.0.0.1:56379/postgres pnpm exec tsx --test 'scripts/ci/participant-catalog-seed-drill.test.ts'
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
```

Existing DDL declaration-parser regression suite:

```text
$ pnpm exec tsx --test scripts/ci/migration-precondition-drill.test.ts
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
```

## Verification

- [x] `pnpm verify:static`: exit 0. This includes lint, type-check, build, the repository test suite, production post-migration checks, Smart Form verification, and command/migration checks.
- [x] `pnpm type-check`: passed as a constituent of `pnpm verify:static`.
- [x] `pnpm test`: passed as a constituent of `pnpm verify:static`.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`; 7 changed files; no rules matched.
- [ ] `pnpm test:db`: exit 1 at the target-identity guard before DB access. Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=127.0.0.1`, `ref=unidentified`). Writable DB verification requires `xskgrzbteyqdufktjrjx`; run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- [ ] `pnpm verify` is not claimed PASS locally: its static phase is proven above, while its writable live-DB phase requires the same protected staging receipt.
- [ ] Protected exact-head CI, PM approval, and governed merge remain pending.

No production credentials, production writes, deployment, Discord action, or delivery activation
was used.

## Runtime Verification

The disposable loopback runtime proof passed 14 tests with zero skips at execution SHA
`cd23bc28724e8378d39d0da5470346518d0603f5`. It used synthetic migration fixtures to prove the
support drill itself; it does not claim execution of the later catalog migrations. Sanctioned
writable staging verification remains explicitly deferred as recorded above.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1729
Execution SHA: `cd23bc28724e8378d39d0da5470346518d0603f5`
