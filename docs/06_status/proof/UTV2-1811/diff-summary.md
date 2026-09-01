# PROOF: UTV2-1811 — shared rate-limit DB contract

MERGE_SHA: 16c15506f4a2132a885073226461b6f0517161af

The value above is the implementation commit — the last non-proof commit on this branch —
not this file's own commit, which cannot exist before the file does. It is an ancestor of
PR HEAD. The post-merge merge-SHA binding is carried in `verification.md`.

## Changed files

| file | change |
|---|---|
| `supabase/migrations/20260901150000_utv2_1811_rate_limit_buckets.sql` | new — `public.rate_limit_buckets` + `public.consume_rate_limit_bucket`, fail-closed precondition, RLS, least-privilege grants |
| `db/migrations-rollback/20260901150000_utv2_1811_rate_limit_buckets.down.sql` | new — drops the function then the table |
| `apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts` | new — relates every runtime `.rpc()` call site to a `CREATE FUNCTION` in `supabase/migrations/` |
| `apps/api/src/t1-proof-utv2-1811-rate-limit-contract.test.ts` | new — two HTTP-level submission regressions: absent function persists nothing, over-limit is 429 not 500 |
| `package.json` | wires both suites into `test:t1-proof:local`, which required verify executes |
| `docs/06_status/proof/UTV2-1811/*` | this proof bundle |
| `docs/06_status/lanes/UTV2-1811.json`, `.ops/sync/UTV2-1811.yml` | lane control plane, written by `ops:lane-start` |

`packages/db/src/database.types.ts` is declared in scope but unchanged — see
`verification.md` for why regeneration is not mechanically required at this head.

`apps/api/src/server.test.ts` is declared in scope and is at its base content. The two HTTP
regressions were originally appended to it; they moved to the lane's own `t1-proof-*` file
so that the migration lane's path authority holds and so that both suites are wired into a
script `pnpm test` actually runs.

## What changed in product terms

Authenticated Smart Form submissions failed with a server error and wrote nothing, because
the shared rate limiter's backing database function existed only in a code comment. The
function now exists in a governed migration, proven on real PostgreSQL. The limiter itself
is unchanged: still fail-closed, still no memory fallback, still refusing traffic in an
environment that lacks the contract.

Production still does not have the function. Nothing about the live failure changes until
the migration is applied there, which is not authorized in this lane.

EVIDENCE:

Real-PostgreSQL execution against staging `xskgrzbteyqdufktjrjx` (17.6), `p_limit = 3`:

```
step                       exceeded  limit  remaining
window-1 call 1            false     3      2
window-1 call 2            false     3      1
window-1 call 3            false     3      0
window-1 call 4            true      3      0
window-2 call 1 (rolled)   false     3      2
rows held for the key after the sweep: 1
p_limit = 0 -> SQLSTATE 22023   null p_key -> 22023   count = -1 -> 23514
re-run of the precondition guard over the applied schema -> SQLSTATE 42P07
```

Privileges read from the catalog, not from a `pg_dump --no-acl` round trip:

```
proacl (function): {postgres=X/postgres,service_role=X/postgres}
relacl (table):    {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
anon EXECUTE: false   authenticated EXECUTE: false   service_role EXECUTE: true
relrowsecurity: true  policies: 0

control object created in the same schema WITHOUT the REVOKE block:
proacl: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
anon EXECUTE: true    anon SELECT: true
```

Apply / down / reapply fingerprints, including ACLs:

```
applied         dd6588d1831a7eba09921beb8854aeee
after down      f77268e36e040e76d2d7e2c466a7c62c
after reapply   dd6588d1831a7eba09921beb8854aeee
reapply_converged: true    down_actually_changed_schema: true
```

CEP-E7 receipts, bound to `16c15506` — the last non-proof commit:

```
precondition_drill          PASS  run 33530973221  job 99933738656
schema_roundtrip_drill      PASS  run 33530973221  job 99933739000
writable_db_proof_staging   PASS  run 33530970352  job 99934207264
live_schema_parity          BLOCKED_ON_PRODUCTION_DDL
                                  run 33530972753  job 99933777688
```

- `docs/06_status/proof/UTV2-1811/verification.md` — full narrative, the real-PostgreSQL semantics table, the ACL catalog reads and the control-object comparison, the apply/down/reapply fingerprints, and the mutation results for every control.
- `docs/06_status/proof/UTV2-1811/evidence.json` — CEP-E7 receipts with exact run and job ids.
- Staging `xskgrzbteyqdufktjrjx` (PostgreSQL 17.6) — where the migration was applied, exercised, rolled back and reapplied.
- Production `zfzdnfwdarxucxtaojxm` — read-only confirmation of absence only.

ASSERTIONS:
- [x] The missing function, not the limiter's policy, caused the submission outage.
- [x] The migration supplies the contract without weakening, bypassing or replacing the fail-closed store.
- [x] Limiter semantics on real PostgreSQL match `InMemoryApiRateLimitStore`, including 429 at limit+1 rather than an exception.
- [x] `anon`, `authenticated` and PUBLIC hold no EXECUTE on the function and no privilege on the table, proven from `pg_proc.proacl` and `pg_class.relacl` rather than from a `pg_dump --no-acl` round trip.
- [x] A control object created without the REVOKE block shows `anon` and `authenticated` would otherwise both hold EXECUTE, so the revokes are load-bearing.
- [x] Apply, down and reapply converge on a byte-identical fingerprint that includes ACLs, and the down script demonstrably changes the schema.
- [x] The fail-closed precondition raises `42P07` over an existing relation and applies cleanly when the relation is absent.
- [x] Every control in this lane was observed failing under mutation before being trusted.
- [x] Both new suites are wired into `test:t1-proof:local` and run under required verify.
- [x] Staging carries the applied contract; production does not, and no production DDL was performed or is authorized.
