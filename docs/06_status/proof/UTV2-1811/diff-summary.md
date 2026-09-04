# PROOF: UTV2-1811 — shared rate-limit DB contract

MERGE_SHA: d04712fa2b878bc72fd6d4d0e0e43f320533c4a3

The value above is the last non-proof commit on this branch — the `--no-ff` merge of
`origin/main` at `b51f509e` performed under the merge mutex via `ops:merge-wrapper
git-merge-main`, which carries implementation commit `4c3a71cf` — not this file's own commit,
which cannot exist before the file does. It is an ancestor of PR HEAD. That merge is
history-preserving, not a rebase: all 30 pre-sync commits remain ancestors, and it brought in
exactly one file, `docs/06_status/readiness/readiness-score.json`, changing no file this lane
owns. The post-merge
merge-SHA binding is carried in `verification.md`.

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

`packages/db/src/database.types.ts` is declared in scope and is deliberately left unchanged.
It therefore does not describe the live production schema at this head: it omits
`rate_limit_buckets` and `consume_rate_limit_bucket`. Nothing shipped breaks on that (the
runtime path calls the RPC by name through the untyped `rpc()` surface), but this is an owned
deferral to schedule, not a step found unnecessary. `verification.md` records the measured
reason — regenerating here would also import 60 unrelated production partition tables.

`docs/06_status/lanes/UTV2-1811.json` is the one changed path that is **not** in
`file_scope_lock`. The lock is pinned to the lane-start commit and cannot be widened, so this
path is admitted only by a PM `scope-override/v1` comment pinned to the exact PR head. The
`File scope lock` check fails until such an override exists at the current head; that is the
sole reason it is red, and it is a governance artifact, not a code defect. The path changed
because the manifest's `file_scope_lock` named two placeholder test paths this lane never
created and omitted three it actually touches — the correction described in `verification.md`.

`apps/api/src/server.test.ts` is **not** in this lane's `file_scope_lock` (see
`docs/06_status/lanes/UTV2-1811.json`, which is the sole authority for lane scope) and is
unchanged from its base content. The two HTTP regressions were originally appended to it;
they moved to the lane's own `t1-proof-*` files precisely because that path is outside this
lane's authority, and the move also wired both suites into a script `pnpm test` actually runs.

## What changed in product terms

Authenticated Smart Form submissions failed with a server error and wrote nothing, because
the shared rate limiter's backing database function existed only in a code comment. The
function now exists in a governed migration, proven on real PostgreSQL. The limiter itself
is unchanged: still fail-closed, still no memory fallback, still refusing traffic in an
environment that lacks the contract.

Production now has the function. It was applied on 2026-09-04 under bounded PM production-DDL
authorization, after re-proving at execution time that this was the sole pending migration. The
live submission failure is therefore addressed at the database layer; it is not yet addressed in
the running service, because this PR is unmerged and production is still serving an older build.

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
applied         206a7c91d518f0262e6da2dfd9dd69e8
after down      ABSENT
after reapply   206a7c91d518f0262e6da2dfd9dd69e8
reapply_converged: true    down_actually_changed_schema: true
```

Measured against the byte-exact committed file: staging `pg_proc.prosrc` hashes to
`7011920a0b001401c505f640bb582481`, equal to the md5 of the function body in the migration
computed independently from disk. Pre-existing-object refusals, on the same byte-exact file:

```
CASE A  table decoy present, function absent   REFUSED 42P07   decoy columns unchanged, 0 DDL
CASE B  exact function decoy present, no table REFUSED 42723   decoy prosrc dcc284fd… unchanged
CASE C  both absent                            APPLIED         fingerprint 206a7c91…

MUTATION C  reviewed shape (table-only guard + CREATE OR REPLACE), CASE B setup
            APPLIED — decoy prosrc dcc284fd… -> dd954ffe…  (silent destruction)
MUTATION D  down script, owned table + decoy function
            REFUSED 42501 on the function marker; decoy survived
```

Comment-stripping parity control, and the mutations that break it:

```
pnpm exec tsx --test apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts
# tests 8   # pass 8   # fail 0

MUTATION A  stripSqlComments() returns input unchanged
            not ok 4, not ok 6   -> 8 tests, 6 pass, 2 fail
MUTATION B  delete the migration file
            not ok 1, not ok 8   -> 8 tests, 6 pass, 2 fail
```

Production migration ledger, read-only from `supabase_migrations.schema_migrations`:

```
BEFORE APPLY: local files 135   remote rows 134   intersection 134
  local-only  : 20260901150000_utv2_1811_rate_limit_buckets.sql   (exactly one)
  remote-only : (none)
APPLIED 2026-09-04 under bounded PM authorization — exactly this one migration.
AFTER APPLY : local files 135   remote rows 135   local-only (none)   remote-only (none)
Supersedes this bundle's earlier reading (8 local / 127 remote / intersection 0 / NO),
which UTV2-1822 resolved by restoring the historical migration files under their
production version numbers with per-file hash receipts.
```

CEP-E7 receipts, all produced at `d04712fa` — the last non-proof commit:

```
precondition_drill          PASS  run 33927369733  job 101198686975
schema_roundtrip_drill      PASS  run 33927369733  job 101198687084
writable_db_proof_staging   PASS  run 33927369846  job 101198687494  (inside required verify)
live_schema_parity          PASS  run 33927369782  job 101198702190  (after production application)
```

- `docs/06_status/proof/UTV2-1811/verification.md` — full narrative, the real-PostgreSQL semantics table, the ACL catalog reads and the control-object comparison, the apply/down/reapply fingerprints, and the mutation results for every control.
- `docs/06_status/proof/UTV2-1811/evidence.json` — CEP-E7 receipts with exact run and job ids.
- Staging `xskgrzbteyqdufktjrjx` (PostgreSQL 17.6) — where the migration was applied, exercised, rolled back and reapplied.
- Production `zfzdnfwdarxucxtaojxm` — read-only confirmation of absence first, then the authorized apply of exactly one migration, the post-apply object and ACL catalog reads, a three-call limiter probe under a dedicated key whose rows were deleted, and a one-row correction of the ledger version to the canonical `20260901150000`.

ASSERTIONS:
- [x] The missing function, not the limiter's policy, caused the submission outage.
- [x] The migration supplies the contract without weakening, bypassing or replacing the fail-closed store.
- [x] Limiter semantics on real PostgreSQL match `InMemoryApiRateLimitStore`, including 429 at limit+1 rather than an exception.
- [x] `anon`, `authenticated` and PUBLIC hold no EXECUTE on the function and no privilege on the table, proven from `pg_proc.proacl` and `pg_class.relacl` rather than from a `pg_dump --no-acl` round trip.
- [x] A control object created without the REVOKE block shows `anon` and `authenticated` would otherwise both hold EXECUTE, so the revokes are load-bearing.
- [x] Apply, down and reapply converge on a byte-identical fingerprint that includes ACLs, and the down script demonstrably changes the schema.
- [x] The fail-closed precondition raises `42P07` over an existing relation and applies cleanly when the relation is absent.
- [x] The migration also refuses with `42723`, before any DDL, when the exact callable `public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer)` already exists, and creates with plain `CREATE` rather than `CREATE OR REPLACE`.
- [x] A pre-existing unrelated implementation survives that refusal byte-identically, and the reviewed shape is shown by mutation to have destroyed it silently.
- [x] The down script refuses to drop either object unless it carries the `UTV2-1811` ownership marker, proven with the function guard exercised in isolation.
- [x] SQL comments can no longer satisfy the RPC parity check; a commented-out `CREATE FUNCTION` is treated as missing, and the control fails under mutation when the stripping is removed.
- [x] The staging replay executed the byte-exact committed migration, closing the earlier normalised-copy fidelity gap.
- [x] Exactly one migration — this lane's — was applied to production under bounded PM authorization, after re-proving at execution time that it was the sole pending one: 135 local files against 134 remote rows, remote-only empty. Afterwards parity is 135 to 135 with both difference sets empty. The earlier blocker reading is recorded rather than erased; UTV2-1822 resolved it.
- [x] Every control in this lane was observed failing under mutation before being trusted.
- [x] Both new suites are wired into `test:t1-proof:local` and run under required verify.
- [x] Staging and production both now carry the applied contract. In production, `anon` and `authenticated` hold no privilege on either object; only `service_role` and `postgres` do.
