# PROOF: UTV2-1811 — Shared rate-limit DB contract

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1477
Verified source SHA: f6b7f415ffb9098e7b49222d1194ac9d130694c1

The verified source SHA is the last non-proof commit on this branch and the head every receipt
below was captured against. It supersedes `e0288a2a`, which the proof-binding validator
correctly refused once `main` moved: two non-proof commits landed after it.

The first is the sanctioned `ops:merge-wrapper git-merge-main` that brought this branch level
with `main` at `5fd7d299`. That verb preserves history rather than rewriting it, so no earlier
SHA quoted in this bundle was invalidated. What `main` introduced is dominated by UTV2-1822,
which restored the historical migration files under their production version numbers and
archived their authoritative sources with per-file hash receipts under
`supabase/migrations_archive/`. That repair is the reason the production migration ledger
section below now reads RESOLVED rather than BLOCKER.

The second is the lane manifest correction: `file_scope_lock` named two placeholder test paths
this lane never created and omitted the three it actually touches.

The substantive migration commit is still `4c3a71cf`, which landed the two fixes returned by PM
review — SQL-comment stripping before the RPC parity scan, and a fail-closed refusal on a
pre-existing exact function. The migration file's bytes are unchanged across the sync
(`md5 af2c42582dbde2ee7990a3ca15c1d3e8`, verified at this head), so every staging fidelity, ACL
and fingerprint claim below still describes the shipped file.

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

### PM review round 2 — fix 1: SQL comments cannot satisfy the parity check

The reviewed revision's `governedFunctionNames()` ran a `CREATE FUNCTION` regex over raw
migration text. A migration whose only mention of the function was
`-- CREATE FUNCTION public.consume_rate_limit_bucket(...)` therefore satisfied the governed
set. The control that exists to prove the contract is real could be satisfied by a comment.

The scan now runs over executable text only. `stripSqlComments()` blanks line comments and
block comments — depth-counted, because PostgreSQL nests them — and skips single-quoted
strings, double-quoted identifiers and dollar-quoted bodies, so a `--` inside a function
body or a `/*` inside a literal is not mistaken for a comment. It is not a SQL parser and
does not try to be one; reliable comment stripping is the whole requirement.

Five fixture tests cover it, each building a throwaway migrations directory:

```
ok 4 - a commented-out CREATE FUNCTION does not make a function governed
         (line comment, block comment, NESTED block comment, and a definition described
          in a comment while a different function is really created)
ok 5 - a real executable CREATE FUNCTION is still governed
ok 6 - commenting out the real definition flips the same fixture from governed to missing
ok 7 - comment characters inside literals and function bodies are not treated as comments
ok 8 - the repository migration set defines consume_rate_limit_bucket in executable SQL

# tests 8   # pass 8   # fail 0
```

Made to fail, twice:

```
MUTATION A — stripSqlComments() returns its input unchanged (the reviewed behaviour)
not ok 4 - a commented-out CREATE FUNCTION does not make a function governed
not ok 6 - commenting out the real definition flips the same fixture from governed to missing
# tests 8   # pass 6   # fail 2

MUTATION B — delete supabase/migrations/20260901150000_utv2_1811_rate_limit_buckets.sql
not ok 1 - every runtime client.rpc() dependency is defined by a governed migration
not ok 8 - the repository migration set defines consume_rate_limit_bucket in executable SQL
# tests 8   # pass 6   # fail 2
```

Mutation A is the exact defect PM named, reproduced and then closed. Mutation B confirms
the real executable definition is still load-bearing rather than merely present.

### PM review round 2 — fix 2: refusal on a pre-existing exact function

The reviewed revision guarded only on the table, and created the function with
`CREATE OR REPLACE`. Those two facts compose into the worst available outcome: on a
database holding an unknown `public.consume_rate_limit_bucket(text, timestamptz,
timestamptz, integer)` and no `rate_limit_buckets` table, the migration would overwrite
that implementation, report success, and leave no record of what the body had been — and
its own down script could not restore it.

The migration now refuses, before any DDL, when the exact callable identity already exists,
and creates with plain `CREATE`. Identity is probed with `to_regprocedure(...)`, not by
comparing `pg_get_function_identity_arguments()` against a type string: that output carries
**parameter names** (`p_key text, p_window_start timestamp with time zone, ...`), so a
type-only comparison silently never matches. That mistake was made here first and was caught
by executing the guard against a database that really did hold the function.

All four cases, replayed on staging (PostgreSQL 17.6) against the **byte-exact committed
file** — `pg_proc.prosrc` on staging hashes to `7011920a0b001401c505f640bb582481`, which is
the md5 of the bytes between the `AS $$` delimiters in the migration, computed independently
from the file on disk. An earlier revision of this bundle replayed a whitespace-normalised
copy; that fidelity gap is closed, and every fingerprint below is a fingerprint of the
shipped migration.

```
CASE A — table exists (decoy: id bigserial, note text), function absent
  REFUSED sqlstate 42P07
  decoy columns before : id:bigint,note:text
  decoy columns after  : id:bigint,note:text
  decoy comment after  : DECOY-NOT-UTV2-1811
  function after       : ABSENT
  UTV2-1811 index created: 0        -> no DDL ran

CASE B — exact function exists (decoy body), table absent      [the new case]
  REFUSED sqlstate 42723
  decoy prosrc md5 before : dcc284fdb3847d29bbca1f50749f09ea
  decoy prosrc md5 after  : dcc284fdb3847d29bbca1f50749f09ea   -> byte-identical
  decoy comment after     : DECOY-NOT-UTV2-1811
  table after             : ABSENT

CASE C — both absent
  APPLIED
  fingerprint before : ABSENT
  fingerprint after  : 206a7c91d518f0262e6da2dfd9dd69e8

CASE D — apply -> down -> reapply
  after apply   : 206a7c91d518f0262e6da2dfd9dd69e8
  after down    : ABSENT                              -> down genuinely changes schema
  after reapply : 206a7c91d518f0262e6da2dfd9dd69e8    -> converged
```

The fingerprint covers relname, relacl, relrowsecurity, every column with type and
nullability, every constraint definition, every index definition, and the function's proacl
and prosrc md5. Each measurement was issued as its own statement: two calls to a
catalog-reading expression inside one `SELECT` share a snapshot and return identical stale
values across an intervening DDL, which silently fakes an "unchanged" result.

Made to fail, twice:

```
MUTATION C — revert to the reviewed shape (table-only guard, CREATE OR REPLACE),
             same setup as CASE B
  APPLIED — the guard did not fire
  decoy prosrc md5 before : dcc284fdb3847d29bbca1f50749f09ea
  decoy prosrc md5 after  : dd954ffea251cf9990184048aa73a6ea
  decoy comment after     : DECOY-NOT-UTV2-1811
```

The md5 change is the destruction. The victim's own comment survives as the only trace,
which is precisely why this failure mode would not have been noticed in production.

```
MUTATION D — down script, table present and UTV2-1811-marked, function present but
             commented DECOY-NOT-UTV2-1811
  REFUSED sqlstate 42501, on the FUNCTION ownership marker
  decoy prosrc md5 after : dcc284fdb3847d29bbca1f50749f09ea  -> survived
```

The table marker is satisfied in that setup deliberately, so the function guard is exercised
in isolation rather than shadowed by the table guard. The positive control is that the same
script, run against the genuinely UTV2-1811-marked pair, dropped both objects successfully:
the guard admits what it should and refuses what it should not. Both `DROP` statements are
unqualified — `IF EXISTS` was removed, because the guard has already established that both
objects exist and are this migration's, and `IF EXISTS` would only hide a disagreement
between the guard and the drop.

### Production migration ledger — RESOLVED; `db push` now selects exactly this migration

The blocker this section previously recorded is gone, and it is worth stating plainly what
changed rather than quietly editing the numbers. When this bundle was first written, the
repository held 8 migration files and production's `supabase_migrations.schema_migrations`
held 127 rows, and **not one local version matched a remote one** — intersection 0. A
`supabase db push --linked` would have re-run the full baseline schema and six
already-applied migrations against a database that already held their objects. That was
reported as a blocker and nothing was applied.

UTV2-1822 repaired the correspondence at the source: it restored the historical migration
files under their production version numbers and archived their authoritative sources with
per-file hash receipts under `supabase/migrations_archive/`. The ledger and the file set now
describe the same history.

Re-measured after that repair, read-only from production `zfzdnfwdarxucxtaojxm` over a
`SELECT` against `supabase_migrations.schema_migrations` — the same table the CLI reads to
build its Remote column. No write, no DDL, no link, no repair:

```
local migration files (this branch)   135
remote ledger rows                    134     min 00000000000000   max 20260803230000
intersection                          134

LOCAL-ONLY  (what `db push --linked` would execute)
  20260901150000   utv2_1811_rate_limit_buckets

REMOTE-ONLY (applied remotely with no local file)
  (none)
```

**Would `supabase db push --linked` execute only
`20260901150000_utv2_1811_rate_limit_buckets.sql`? Yes — and nothing else.** `db push` keys
the version prefix of each local filename against `schema_migrations.version`; a local
version absent from that column is pending. Exactly one local version, `20260901150000`, is
absent. Every other local file, all 134 of them, is present remotely. The remote-only set is
empty, so the correspondence holds in both directions and the ledger is not merely a superset.

Migration immediately preceding UTV2-1811 locally:
`20260803230000_utv2_1540_command_center_ledger_repair.sql`, which is remote version
`20260803230000` — present, and therefore not re-run.

Still stopped here. **No push has been executed and no production DDL has been applied.**
This section proves the selection is now safe and precise; it does not authorize the apply.
Applying `20260901150000` to production requires explicit production-DDL authorization,
which this lane does not hold. `live_schema_parity` below remains FAIL for exactly that
reason and is the only remaining gate on this lane.

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

### What has a CI receipt and what does not

An independent audit at exact head correctly flagged that this bundle mixes two grades of
evidence in the same schema position. Stated plainly:

**Receipted — verifiable from GitHub Actions, bound to `f6b7f415`:**

```
precondition_drill          PASS  run 33658161099  job 100341823650
schema_roundtrip_drill      PASS  run 33658161099  job 100341824294
writable_db_proof_staging   PASS  run 33658161190  job 100342098974  (inside required verify)
live_schema_parity          FAIL  run 33658161186  job 100341847669  (honestly recorded, not waived)
```

A fifth job in the same reversibility-gate run, `proof-binding-validator` ("Down-script
presence check (fail-closed)"), is not a CEP-E7 receipt slot but is worth naming so nobody has
to rediscover it from the job list. It fails on any non-proof file that changed after the
declared anchor, which is exactly what the main-sync and the manifest correction are. This
proof-only commit re-anchors to `f6b7f415` — the last of those non-proof commits — for that
reason, and it is the only commit after `f6b7f415` on this branch.

**Not receipted — read by the orchestrator against staging, no run or job id:** the ACL
catalog reads, the control-object comparison, the ACL-inclusive round-trip fingerprints,
and the limiter semantics table. No CI job in this repo can produce them:
`schema-roundtrip-hash.ts` runs `pg_dump --no-acl`, and the CI scratch Postgres has no
`anon`, `authenticated` or `service_role` role to grant to in the first place. That is the
whole reason the ACL condition had to be proven directly. These are re-derivable by
re-running the same catalog queries against staging, but they rest on this capture, not on
an Actions artifact, and should be weighed accordingly.

### The closeout consequence of the parity failure

`live_schema_parity` not passing is not merely cosmetic. Close Eligibility Preflight fails
CEP-E7 on that field and therefore CEP-C1, whose message is that `ops:lane-close` would
fail after merge. Merging before the migration is applied to production would strand this
lane merged-but-unclosable. The order that avoids it: apply to production, let parity go
green, then merge and close.

### The standing cost of holding this lane open

`proof-binding-validator` diffs from the PR *merge ref*, not from the branch alone, so any bot
commit on `main` is attributed to this branch and reddens the gate. `main` takes bot commits
continuously (readiness-ledger refreshes every few hours), so this bundle degrades on its own
the longer the lane stays open, and each re-anchor costs a full receipt re-capture. That is a
real cost of the wait for production-DDL authorization, not an argument for merging early — the
CEP-E7 consequence above is the reason merging early is worse.

### What this migration does not own

`p_window_start` and `p_window_expires_at` are caller-supplied, not computed in the
function. Correct windowing depends on the API server flooring `now` to the window boundary
before calling. The function rejects null boundaries and `p_limit < 1` with `22023` and the
table CHECK requires `expires_at > window_start`, but consistent windowing is an API-side
contract, out of scope here and named rather than left implicit.

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
- [x] `consume_rate_limit_bucket` was absent from production, staging and every governed migration before this change.
- [x] The applied function's callable signature matches the four named arguments `SupabaseRpcApiRateLimitStore` sends.
- [x] Limiter semantics on real PostgreSQL are identical to `InMemoryApiRateLimitStore`, including 429 at limit+1 rather than an exception.
- [x] `anon`, `authenticated` and PUBLIC hold no EXECUTE on the function and no privilege on the table; a control without the revokes shows all three would otherwise have it.
- [x] Apply → down → reapply converges on a byte-identical fingerprint that includes ACLs.
- [x] The fail-closed precondition raises `42P07` over an existing relation and applies cleanly when absent.
- [x] Every control in this lane was observed failing under mutation.
- [x] No production DDL, no production write, no containment change.
