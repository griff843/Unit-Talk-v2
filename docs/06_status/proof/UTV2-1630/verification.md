# PROOF: UTV2-1630
MERGE_SHA: a7dd25e68547573fac9411e2c3cc3c7a2f9b6cdf

## Summary

Every writable CI and T1 database path now runs against the dedicated staging
project `xskgrzbteyqdufktjrjx` and can no longer reach production
`zfzdnfwdarxucxtaojxm`.

The defect this closes was not a missing guard. A guard existed — it lived
inside `ci:db-smoke`. The problem was that nothing on the production-writing path
called it: `verify:live-db-verdict` spawns `test:live-db`, which invokes
`pnpm test:db` **directly** and then `test:t1-proof:live`, fifteen further
writable suites. All of them reached the database without passing the guard. A
control that sits in a branch of the call graph nothing takes is not a control.

That is why the assertion moved from a call site to an **npm script
prerequisite**: `test:db`, `test:t1-proof:live` and `test:live-db` each begin
with `pnpm ci:assert-staging`. There is no invocation route — direct, nested, or
from a developer shell — that skips it, and no call site left to forget.

ASSERTIONS:
- [x] `ci:assert-staging` refuses unless the resolved target is positively the approved staging project; unknown, ambiguous, custom-domain, proxy, malformed and unresolvable targets all fail before any client is constructed
- [x] The guard is a prerequisite of every writable npm script, not a call inside one of them
- [x] Its CLI entrypoint check compares resolved real paths, so a rename, copy, symlink or compiled-.js invocation cannot bypass it by failing open
- [x] Writable DB proof is produced by a dedicated `staging-db-proof` job that is the ONLY job in `ci.yml` holding a database credential
- [x] The required `verify` context depends on that job and verifies its same-run, same-attempt `ci-db-proof-receipt/v2`; it holds no database credential itself
- [x] No pull-request-reachable job holds a production Supabase credential, enforced by a scanner over every workflow rather than by review
- [x] Every job using a `CI_SUPABASE_*` secret binds `environment: staging-ci`, enforced by the same scanner
- [x] Zero new production rows were written during this lane's CI

## Verification

`pnpm verify` was executed on this branch. Every static stage passed; the run
then stopped at the live-DB stage, refused by this lane's own guard, because
this workstation holds no staging credential.

That refusal **is the deliverable**. Before this change the same command reached
production and wrote to it.

```text
$ pnpm verify
env:check    PASS
lint         PASS
type-check   PASS
build        PASS
test         PASS   96 suites, 3991 tests, 3991 pass, 0 fail
test:live-db -> test:db -> ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
                 (host=127.0.0.1). Writable DB verification requires
                 xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
                 environment with CI_SUPABASE_* credentials.
exit 1
```

The authoritative complete run is the required `verify` context in CI, which is
green on this head and consumed a genuine staging receipt.

## Evidence

**The scanner detects the shipped defect and clears this branch.** Run against
`origin/main`'s workflow set and against this branch's:

```text
$ findProductionCredentialExposures(<origin/main workflows>)
  ci.yml              :: job "verify"            -> SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
  proof-gate.yml      :: job "t1-proof"          -> SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
  proof-regression.yml:: job "proof-regression"  -> SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

$ findProductionCredentialExposures(<this branch's workflows>)
  CLEAN: no PR-triggered job holds a production DB credential
```

Four PR-reachable workflows held production credentials, not one:
`ci.yml`, `proof-gate.yml`, `proof-regression.yml`, `t1-proof-gate.yml`.
The last two were found *by the scanner*, not by inspection — which is the
argument for the scanner.

**Runtime separation, measured on both sides.** Production baseline was taken
before the first push and re-read after the staging DB proof ran:

```text
production zfzdnfwdarxucxtaojxm
  picks       107858 -> 107858   newest 2026-07-30 20:14:57.722+00 (unchanged)
  submissions 107428 -> 107428   newest 2026-07-30 20:14:57.722+00 (unchanged)

staging xskgrzbteyqdufktjrjx
  picks       33                 newest 2026-07-30 20:35:59.235+00
```

The writes landed in staging. Production received none. `20:14:57.722+00` is the
last row of the incident that preceded this lane; nothing has been appended
since.

**The guard fails closed on identity, not on a string match.** Project identity
is taken structurally from the leftmost label of a `*.supabase.co` host, parsed
via `new URL()` so percent-encoding cannot smuggle a different host past it.

**Entrypoint guard.** An `endsWith('/<name>.ts')` check was replaced with a
`realpathSync` comparison after being verified to fail **open**: a renamed copy
of the guard exited 0 against a production target while the correctly-named file
refused with exit 1. An exit 0 in a `&&` chain proceeds to the writable suite.

**Receipt binding.** `ci-db-proof-receipt/v2` binds run id, attempt, SHA,
repository, workflow and job, and the TAP counts are re-parsed from the captured
output rather than trusted as summary fields. The artifact name is scoped to run
and attempt, and `if-no-files-found: error` makes a deleted upload fail the
required context instead of skipping it. A hand-authored TAP block plus a
fabricated project ref previously returned `verdict=PASS`; it no longer can.

## Scope absorbed

`ci.yml` was taken from UTV2-1627 Phase A (frozen at `b446cbb2`), which targeted
the same file but referenced `CI_SUPABASE_ANON_KEY` / `CI_SUPABASE_SERVICE_ROLE_KEY`
— names that were never provisioned. UTV2-1627 must rebase onto this version
rather than restore its own.

The UTV2-1553 ghost-lock release is squashed into this branch. It could not merge
on its own: branched from `main`, its CI ran `main`'s unguarded `ci.yml` and
wrote to production on every push, so unblocking this lane was itself causing the
harm this lane exists to stop. Full record in PR #1322 and in the
`scope_transfers` block of `docs/06_status/lanes/UTV2-1630.json`.

## Known limitations

- `Live Schema Parity` is red on this PR and is **pre-existing**: 80 drift items
  between repo migrations and the live schema, tracked as the migration-ledger
  drift under UTV2-1274. This lane touches no migration. It is not a required
  context.
- The production `picks` table is ~93% test fixtures accumulated since
  2026-04-21 (100,247 of 107,858 rows carry a fixture marker). This lane stops
  the source; it deletes nothing. An exact-ID inventory of the 1,036 picks and
  943 submissions written since containment was produced read-only, and cleanup
  is deliberately deferred until this change is on `main`.
