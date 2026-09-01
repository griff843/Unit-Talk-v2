# PROOF: UTV2-1811 — Shared rate-limit DB contract

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1477
Verified source SHA: 16c15506f4a2132a885073226461b6f0517161af

The verified source SHA is the last non-proof commit on this branch and the head every
receipt below was captured against. The branch's other commits are `ac47388c` and
`330e47d6` (lane manifest, sync metadata and PR binding, written by `ops:lane-start` and
by the lane-binding workflow) and `97e2d9eb`, the first implementation commit, superseded
by 16c15506f4a2132a885073226461b6f0517161af after required verify's executable-wiring check
correctly refused a test file that was reachable from no package script.

## Verification

### What was broken

`assertProductionRateLimitConfig` refuses to start a production-like API runtime on the
in-memory rate limit store, so production runs `UNIT_TALK_API_RATE_LIMIT_STORE=supabase_rpc`.
That store's only operation calls `consume_rate_limit_bucket`, which was specified in a
comment on `SupabaseRpcApiRateLimitStore` and never written into a migration. It existed in
no environment. Because the store fails closed, the throw landed in `handleSubmissions`
*before* `handleSubmitPick`, so every authenticated submission failed and wrote nothing.

Confirmed by read-only query against production (`zfzdnfwdarxucxtaojxm`) and staging
(`xskgrzbteyqdufktjrjx`): `consume_rate_limit_bucket` was present in neither.

### Real PostgreSQL execution — staging, PostgreSQL 17.6

Applied as migration `utv2_1811_rate_limit_buckets`.

Function identity as PostgREST resolves it:

```
identity_args: p_key text, p_window_start timestamp with time zone,
               p_window_expires_at timestamp with time zone, p_limit integer
result_type:   TABLE(exceeded boolean, "limit" integer, remaining integer,
                     reset_at timestamp with time zone)
prosecdef:     false   (SECURITY INVOKER)
```

Semantics against the applied objects, `p_limit = 3`:

| step | exceeded | limit | remaining |
|---|---|---|---|
| window-1 call 1 | false | 3 | 2 |
| window-1 call 2 | false | 3 | 1 |
| window-1 call 3 | false | 3 | 0 |
| window-1 call 4 | **true** | 3 | 0 |
| window-2 call 1 (rolled) | false | 3 | 2 |

Identical to `InMemoryApiRateLimitStore`: the limit-th request is allowed and the
(limit+1)-th is refused. Rows held for the key after the window rolled: **1** — the
per-key sweep bounds growth rather than accumulating a row per window.

Negative cases refuse rather than admit: `p_limit = 0` and a null `p_key` both raise
`22023`; a negative `count` raises `23514`.

### Privileges — proven directly, not via pg_dump

`scripts/ci/schema-roundtrip-hash.ts` runs `pg_dump --no-acl`, so the CI round-trip drill
cannot observe grants at all, and CI's scratch Postgres has no `anon`/`authenticated` role
to catch a missing revoke either. The ACL condition is therefore proven from the catalog:

```
proacl (function): {postgres=X/postgres,service_role=X/postgres}
relacl (table):    {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

anon          EXECUTE on function : false
authenticated EXECUTE on function : false
service_role  EXECUTE on function : true
anon          SELECT  on table    : false
authenticated INSERT  on table    : false
relrowsecurity: true      policies: 0
```

No `=X/postgres` entry, so PUBLIC holds no EXECUTE.

**The revokes are load-bearing, not ceremony.** An identical table and function created in
the same `public` schema *without* the REVOKE block came out as:

```
relacl:  {postgres=...,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=...}
proacl:  {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,...}
anon EXECUTE: true      anon SELECT: true
```

Supabase's `ALTER DEFAULT PRIVILEGES` grants both roles explicit ACL entries, so a
`REVOKE ... FROM PUBLIC` alone would have left `anon=X` and `authenticated=X` standing.
The control objects were dropped after measurement.

### Reversibility on real PostgreSQL

Schema fingerprint (including `relacl` and `proacl`, which the CI drill cannot see):

```
applied         dd6588d1831a7eba09921beb8854aeee
after down      f77268e36e040e76d2d7e2c466a7c62c
after reapply   dd6588d1831a7eba09921beb8854aeee
```

`reapply_converged: true`, and `down_actually_changed_schema: true` — the down script does
real work, so convergence is not the trivial result of a no-op.

### Fail-closed precondition

Re-running the migration's first statement against the applied schema raises exactly
`SQLSTATE 42P07`. Running it when the table is absent applies in full, so the guard is not
simply always-refusing. CI's `precondition-drill` job asserts both independently.

### Static verification

```
pnpm verify                     # lint, pnpm type-check, build and pnpm test all pass;
                                # stops only at test:live-db, which refuses by design off
                                # the staging-ci environment (see below)
pnpm type-check                 # exit 0
pnpm test                       # every suite green, including test:t1-proof:local
pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1811
                                # Verdict: PASS — 9 changed files, no R-level artifacts required
node scripts/lint-migrations.mjs # 7 migration files checked — no findings

# the two suites this lane adds, inside test:t1-proof:local
apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts   # tests 3  pass 3  fail 0
apps/api/src/t1-proof-utv2-1811-rate-limit-contract.test.ts   # tests 2  pass 2  fail 0
```

### Every control was made to fail

| control | mutation | observed |
|---|---|---|
| RPC contract parity | delete the migration file | `not ok 1 — consume_rate_limit_bucket (called from apps/api/src/server.ts)` |
| submission persists nothing when the function is absent | swap in a working store | the assertion on a >= 500 status fails |
| over-limit request is 429 not 500 | swap in the missing-function store | the assertion on 201/201/429 fails |

A fourth control was supplied by CI rather than by me. Required verify's
executable-wiring check failed with `WIRING_TEST_UNWIRED_NEW` on the parity test,
which was reachable from no package script and would therefore never have run. Both
suites are now wired into the root `test:t1-proof:local` script, which `pnpm test`
executes. Note that `apps/api`'s own `test` script is not the one required verify runs;
wiring into it would have satisfied nothing.

### What is deliberately not claimed

The HTTP-level tests use store doubles. A double cannot prove any database contains the
function — supplying a working fake is exactly how this defect stayed invisible through 50
passing tests. The SQL behaviour above is proven against real PostgreSQL instead; the split
is intentional and neither half is presented as the other.

`packages/db/src/database.types.ts` is unchanged. `scripts/generate-types.mjs` generates
from the linked project, which is production, where this migration is not applied and not
authorized to be. Regenerating now would emit types that omit these objects and would sweep
in unrelated production drift. Type-check passes without it, so regeneration is not
mechanically required at this head; it belongs after production application.

### Containment

Track Only enforcement, member-delivery parking, worker parking, ingestor parking and
`SYNDICATE_MACHINE_ENABLED=false` are all untouched. No production DDL was performed and no
Smart Form submission was attempted.

## Assertions

EVIDENCE:
- `supabase/migrations/20260901150000_utv2_1811_rate_limit_buckets.sql` — the governed migration.
- `db/migrations-rollback/20260901150000_utv2_1811_rate_limit_buckets.down.sql` — the down script.
- `apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts`, `apps/api/src/t1-proof-utv2-1811-rate-limit-contract.test.ts` — the static and HTTP-level controls, wired into `test:t1-proof:local`.
- `docs/06_status/proof/UTV2-1811/evidence.json` — CEP-E7 receipts: precondition drill, schema round-trip drill and staging writable-DB proof, each with its exact run and job id, plus the recorded reason live schema parity cannot pass before production application.
- Staging `xskgrzbteyqdufktjrjx` (PostgreSQL 17.6) — real-PostgreSQL execution, ACL catalog reads and the apply/down/reapply fingerprints quoted above.
- Production `zfzdnfwdarxucxtaojxm` — read-only confirmation that `consume_rate_limit_bucket` is absent. No DDL and no write was performed there.

ASSERTIONS:
- `consume_rate_limit_bucket` was absent from production, staging and every governed migration before this change.
- The applied function's callable signature matches the four named arguments `SupabaseRpcApiRateLimitStore` sends.
- Limiter semantics on real PostgreSQL are identical to `InMemoryApiRateLimitStore`, including 429 at limit+1 rather than an exception.
- `anon`, `authenticated` and PUBLIC hold no EXECUTE on the function and no privilege on the table; a control without the revokes shows all three would otherwise have it.
- Apply → down → reapply converges on a byte-identical fingerprint that includes ACLs.
- The fail-closed precondition raises `42P07` over an existing relation and applies cleanly when absent.
- Every control in this lane was observed failing under mutation.
- No production DDL, no production write, no containment change.
