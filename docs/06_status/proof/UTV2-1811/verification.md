# PROOF: UTV2-1811 — Shared rate-limit DB contract

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1477
Verified source SHA: e144a10b8743fb8766b371932701a11cc7b474c3

The verified source SHA is the last non-proof commit on this branch. All four CEP-E7 receipts —
the precondition drill, the schema round-trip drill, the staging writable-DB proof and the live
schema parity check — were captured against exactly this head. That is possible because the
main-sync merge commit was pushed ALONE, before any proof edit, so CI minted every receipt at the
declared anchor rather than at a later proof-only commit.

Earlier parity receipts are retained as history and are not re-attributed to this anchor: parity
could only first be re-run after the production apply, so it was captured one proof-only commit
after the previous anchor at `af59edb5`, and again at `5425edbe0` (run 33853547721, job
100961574766). Parity reflects live database state, which does not depend on which commit
triggered the check. This anchor supersedes `6c7d2a2a`, which the proof-binding validator
correctly refused once `main` moved and a non-proof commit landed after it.

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

Schema fingerprint (including `relacl` and `proacl`, which the CI drill cannot see).
Values are generated from `evidence.json` `runtime_proof.reversibility`, which is the
single source for them; they are measured against staging on the byte-exact migration
file (see `runtime_proof.staging_replay_fidelity`):

```
applied         206a7c91d518f0262e6da2dfd9dd69e8
after down      ABSENT
after reapply   206a7c91d518f0262e6da2dfd9dd69e8
```

`after down` is `ABSENT` because the down script removes both objects outright, so there
is no schema left to fingerprint. `reapply_converged: true`, and
`down_actually_changed_schema: true` — the down script does real work, so
convergence is not the trivial result of a no-op.

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
                                # Verdict: PASS — no R-level artifacts required. The changed-file
                                # count this prints rises with every proof-only commit, so no
                                # value for it is quoted here at all: any number recorded would be
                                # stale by the next commit without anything substantive changing.
                                # Re-run it if you want the current count.
node scripts/lint-migrations.mjs # 134 migration file(s) checked — no findings (the baseline
                                # replay-root is skipped by design, so 134 of the 135 files)

# the two suites this lane adds, inside test:t1-proof:local
apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts   # tests 8  pass 8  fail 0
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

### PM review round 3 — both fixes reverified by mutation at the current head

The PM directive of 2026-09-04 required that the two round-2 fixes be **reverified, not
asserted**, at the head that would actually merge. They were re-executed at anchor
`6c7d2a2a` against a disposable PostgreSQL 15.19 container created and destroyed for the
drill. A scratch container rather than staging, because these controls can only be exercised
by seeding a database into a deliberately colliding state, which staging may not be put into.

**Fix 1 — SQL comments cannot satisfy RPC parity detection.** The mutation is what settles
this, not re-reading `stripSqlComments`. Reverting the single call site in
`governedFunctionNamesIn` to the pre-fix `readFileSync` with no stripping reproduces exactly
the false positive the PM named:

```
# baseline, unmutated
# tests 8   # pass 8   # fail 0

# mutated: stripSqlComments no longer applied
not ok 4 - a commented-out CREATE FUNCTION does not make a function governed
    a line-commented definition was treated as governed; the parity check can be
    satisfied by the defect it detects
not ok 6 - commenting out the real definition flips the same fixture from governed to missing
# tests 8   # pass 6   # fail 2
```

The file was then restored and `git diff` confirmed clean. The test fails on precisely the
condition it names, so it is load-bearing rather than self-consistent.

**Fix 2 — refusal before DDL on a pre-existing exact function.** Executed against a database
holding an out-of-band implementation of this exact signature and no `rate_limit_buckets`
table — the reviewer's scenario precisely:

```
ERROR:  42723: public.consume_rate_limit_bucket(text, timestamptz, timestamptz, integer)
        already exists; UTV2-1811 refuses to replace a function it did not create.

table after:            NONE — no DDL ran
index count after:      0
foreign body md5 before 7d9d6da622819d369bd72cad02da3560
foreign body md5 after  7d9d6da622819d369bd72cad02da3560   (byte-identical)
```

The table guard was re-executed too: on a database holding only the table it raises `42P07`
and no function is created.

**The guard is load-bearing — mutation control.** Removing only the `to_regprocedure` block
(617 characters) and re-running against the same seeded state:

```
CREATE TABLE
CREATE INDEX
ERROR:  function "consume_rate_limit_bucket" already exists with same argument types

table after: rate_limit_buckets PRESENT — the database is left half-applied
```

So without the guard the migration genuinely does damage: it creates the table and index
before dying, leaving a split-brain schema. With it, nothing is touched. Separately, the
migration uses `CREATE FUNCTION` rather than `CREATE OR REPLACE`, so the reported overwrite
path is closed twice over — a bypassed guard still cannot silently replace a body.

**The down script refuses objects it did not create.** Against unmarked out-of-band objects:

```
ERROR:  42501: public.rate_limit_buckets does not carry the UTV2-1811 ownership marker;
        this rollback refuses to drop an object it did not create.
objects after: both survive
```

**Forward, rollback and reapply**, with `anon`, `authenticated` and `service_role` created
first so the role-guarded REVOKE/GRANT branches actually executed instead of being skipped:
apply → rollback → reapply all clean, and the function is functional after the reapply.

**Privileges, measured rather than read off the migration text**, via
`has_table_privilege` / `has_function_privilege`:

```
anon           table (none)     function EXECUTE false
authenticated  table (none)     function EXECUTE false
PUBLIC                          function EXECUTE false
service_role   SELECT,INSERT,UPDATE,DELETE   function EXECUTE true
RLS enabled: true          policies: 0   (deny by default)
```

**Limiter semantics, five sequential calls at limit=3** — each its own connection, because a
single statement calling the function repeatedly shares a snapshot and is not the call
pattern the store uses:

```
call 1 -> exceeded=f remaining=2
call 2 -> exceeded=f remaining=1
call 3 -> exceeded=f remaining=0
call 4 -> exceeded=t remaining=0
call 5 -> exceeded=t remaining=0     stored count: 5
```

The limit-th request is allowed and the (limit+1)-th refused; `remaining` clamps at zero. A
call in the next window created a new row and swept the expired one, leaving exactly one row
for the key. `p_limit=0` and `p_key=NULL` both raise `22023` — the limiter fails closed on
misconfiguration rather than admitting traffic.

**Concurrency.** 40 concurrent callers, 8-way parallel, all on the same `(key, window_start)`,
each a separate connection: 0 errors, stored count exactly 40, exactly 1 row. No lost
increments — the single `INSERT ... ON CONFLICT DO UPDATE` is both the increment and the
window roll.

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
build its Remote column. **This measurement step** performed no write, no DDL, no link and no
repair. That is a statement about the measurement only, not about the lane: the authorized
apply described below did write to this same table, and one row of it was subsequently
corrected. The two are kept separate here so the read-only claim cannot be mistaken for a
summary of everything that happened to production:

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

**Applied 2026-09-04 under bounded PM production-DDL authorization.** The authorization was
tied to PR head `af59edb547931dc3e1b975d391f55483124fc483` and migration blob
`56d1559665018598bc9d84ca2a4abafdf1ee9b53`, permitted exactly one migration, and was
conditional on rechecking that it was the sole pending migration. It did not authorize merge,
deployment, rollback, containment change or a pilot submission, and none of those was performed.

The precondition was rechecked immediately before execution rather than relied on from the
capture above: the head matched, the blob was re-hashed after extraction and matched, and the
bidirectional join returned local-only `20260901150000` and remote-only empty. Both objects
were confirmed absent (`to_regclass` and `to_regprocedure` both null). Exactly the statements
in the authorized file were executed against `zfzdnfwdarxucxtaojxm`; nothing else was run.

After the apply, `public.rate_limit_buckets` and
`consume_rate_limit_bucket(text, timestamptz, timestamptz, integer)` both resolve, RLS is
enabled with zero policies, and two indexes are present.

**One correction was necessary and is recorded rather than hidden.** The apply tool registered
the ledger version as `20260904081351`, not the repository filename version `20260901150000` —
the same version-regeneration behaviour that produced the divergence UTV2-1822 repaired. One
row of `supabase_migrations.schema_migrations` was updated to the canonical version. No other
row was touched. Parity afterwards is 135 local files against 135 remote rows with both
difference sets empty.

### What is deliberately not claimed

The HTTP-level tests use store doubles. A double cannot prove any database contains the
function — supplying a working fake is exactly how this defect stayed invisible through 50
passing tests. The SQL behaviour above is proven against real PostgreSQL instead; the split
is intentional and neither half is presented as the other.

`packages/db/src/database.types.ts` remains unchanged, and after production application the
earlier reasoning was re-tested rather than carried forward. Generating types from production
now emits both new objects correctly — `rate_limit_buckets` with its four columns and
`consume_rate_limit_bucket` with its four arguments and four-column return — but it *also*
introduces **60 `provider_offer_history_p2026MMDD` partition tables** that exist in production
and in no repo migration. Those partitions are created by partition management, are unrelated
to this lane, and adopting them here would put production drift this lane does not own inside
its diff. The measured object-set difference is exactly those 60 partitions plus this lane's
two objects, with nothing removed.

Regeneration is also not reproducible from this checkout: `scripts/generate-types.mjs` needs
`SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_URL`, both of which are containment stubs here, so the
only available route would be hand-editing a generated file. No CI gate enforces freshness of
this file and `type-check` passes without it. Regeneration therefore belongs to a separate,
owner-credentialed lane that can also decide what to do about the 60 partitions.

### What has a CI receipt and what does not

An independent audit at exact head correctly flagged that this bundle mixes two grades of
evidence in the same schema position. Stated plainly:

**Receipted — verifiable from GitHub Actions, all produced at the anchor `e144a10b`:**

```
precondition_drill          PASS  run 33885648147  job 101064628269
schema_roundtrip_drill      PASS  run 33885648147  job 101064628349
writable_db_proof_staging   PASS  run 33885648574  job 101064630552  (inside required verify)
verify (required)           PASS  run 33885648574  job 101066280520  14:51:33Z -> 14:55:56Z
live_schema_parity          PASS  run 33885648272  job 101064656760  (after production application)
```

A fifth job in the same reversibility-gate run, `proof-binding-validator` ("Down-script
presence check (fail-closed)"), is not a CEP-E7 receipt slot but is worth naming so nobody has
to rediscover it from the job list. It fails on any non-proof file that changed after the
declared anchor, which is exactly what the main-sync and the manifest correction are. This
proof-only commit re-anchors to `e144a10b` — the `--no-ff` merge of `origin/main`
`7116561a` performed by the sanctioned `ops:merge-wrapper git-merge-main` under the merge
mutex, which is the last non-proof commit on this branch — for that reason, and the commits
after it touch only proof paths. That merge commit was pushed ALONE, before any proof edit, so
all four CEP-E7 receipts above were minted at exactly the declared anchor rather than at a
later proof commit.

**Not receipted — read by the orchestrator against staging, no run or job id:** the ACL
catalog reads, the control-object comparison, the ACL-inclusive round-trip fingerprints,
and the limiter semantics table. No CI job in this repo can produce them:
`schema-roundtrip-hash.ts` runs `pg_dump --no-acl`, and the CI scratch Postgres has no
`anon`, `authenticated` or `service_role` role to grant to in the first place. That is the
whole reason the ACL condition had to be proven directly. These are re-derivable by
re-running the same catalog queries against staging, but they rest on this capture, not on
an Actions artifact, and should be weighed accordingly.

### The closeout consequence, now resolved

`live_schema_parity` not passing was never merely cosmetic: Close Eligibility Preflight failed
CEP-E7 on that field and therefore CEP-C1, whose message is that `ops:lane-close` would fail
after merge, which would have stranded this lane merged-but-unclosable. The order that avoids
that outcome is apply to production, let parity go green, then merge and close. This lane has
followed that order as far as it goes today: the apply is done and parity is green. Merge and
close have NOT happened — PR #1477 is open and unmerged, and this bundle does not claim
otherwise. Parity now passes at run 33885648272 (job 101064656760), produced at
the current anchor, so CEP-E7 has a passing receipt with exact run and job ids and the closeout
path is open.

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
`SYNDICATE_MACHINE_ENABLED=false` are all untouched.

One production DDL was performed: the single migration authorized by the PM, described above.
It creates a rate-limit counter table and its accessor function and touches no existing object.
No deployment was run, no containment posture was changed, no parked system was unparked, and
no Smart Form submission was attempted. The only production rows ever written were three
counter rows under a dedicated probe key, which were deleted; the table is at zero rows.

## Assertions

EVIDENCE:
- `supabase/migrations/20260901150000_utv2_1811_rate_limit_buckets.sql` — the governed migration.
- `db/migrations-rollback/20260901150000_utv2_1811_rate_limit_buckets.down.sql` — the down script.
- `apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts`, `apps/api/src/t1-proof-utv2-1811-rate-limit-contract.test.ts` — the static and HTTP-level controls, wired into `test:t1-proof:local`.
- `docs/06_status/proof/UTV2-1811/evidence.json` — CEP-E7 receipts: precondition drill, schema round-trip drill, staging writable-DB proof and live schema parity, each with its exact run and job id, all PASS; plus the production apply record, the production ACL measurement and the production limiter-semantics probe.
- Staging `xskgrzbteyqdufktjrjx` (PostgreSQL 17.6) — real-PostgreSQL execution, ACL catalog reads and the apply/down/reapply fingerprints quoted above.
- Production `zfzdnfwdarxucxtaojxm` — the authorized apply of exactly one migration, the post-apply object and ACL catalog reads, and a three-call limiter probe under a dedicated key whose rows were then deleted.

ASSERTIONS:
- [x] `consume_rate_limit_bucket` was absent from production, staging and every governed migration before this change.
- [x] The applied function's callable signature matches the four named arguments `SupabaseRpcApiRateLimitStore` sends.
- [x] Limiter semantics on real PostgreSQL are identical to `InMemoryApiRateLimitStore`, including 429 at limit+1 rather than an exception.
- [x] `anon`, `authenticated` and PUBLIC hold no EXECUTE on the function and no privilege on the table; a control without the revokes shows all three would otherwise have it.
- [x] Apply → down → reapply converges on a byte-identical fingerprint that includes ACLs.
- [x] The fail-closed precondition raises `42P07` over an existing relation and applies cleanly when absent.
- [x] Every control in this lane was observed failing under mutation.
- [x] Exactly one production DDL was performed, under bounded PM authorization, after rechecking at execution time that it was the sole pending migration; no merge, deployment, rollback, containment change or pilot submission accompanied it.
- [x] In production, `anon` and `authenticated` hold no EXECUTE on the function and no privilege on the table; only `service_role` and `postgres` do.
- [x] In production, three sequential calls at limit 2 allow, allow, then refuse — identical to `InMemoryApiRateLimitStore`.
- [x] Repo and production migration ledgers are at full bidirectional parity, 135 to 135.
