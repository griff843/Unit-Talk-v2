# PROOF: UTV2-1628

MERGE_SHA: pending

## Summary

Every privileged database client in this repository is now constructed in one
place, and that place refuses to open a connection to canonical production
`zfzdnfwdarxucxtaojxm` from any process the node:test runner started.

The lane before this one made `pnpm ci:assert-staging` a prerequisite of the
writable npm scripts. That closed the *invocation* surface — the routes through
`package.json`. It could not close the *construction* surface: 87 modules called
`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` themselves, 93 call
sites in total. Run one of those files directly and no npm script is involved,
so no prerequisite is either.

Eight of those 87 were reachable from a `pnpm test` entrypoint through the
static import graph. That is not a hypothetical: `pnpm test` really did
construct a service-role Supabase client — `apps/worker/src/worker-runtime.test.ts`
→ `createWorkerRuntimeDependencies` → `createProductionCertificationRuntime` →
`createDatabaseClientFromConnection`. It survived on the accident that the
fixture named a host that happened not to be production.

ASSERTIONS:

- [x] One module, `packages/db/src/privileged-client-boundary.ts`, is the only place a database driver is constructed for a privileged path
- [x] It uses UTV2-1630's `extractProjectRefFromUrl` / `isApprovedStagingTarget` — the implementation moved into `@unit-talk/db/target-identity` and is re-exported from its original home, so there is still exactly one identity check in the repository
- [x] From a restricted context (node:test, `UNIT_TALK_DB_TARGET_POLICY=staging-only`, `NODE_ENV=test`) only the approved staging project and literal loopback are permitted; production, unidentified hosts, custom domains, poolers, tunnels, malformed and empty URLs all refuse
- [x] Outside a restricted context the boundary does not interfere — production runtime reaches production
- [x] The key's role is read from the key, not declared by the caller; an unreadable key is treated as privileged
- [x] 93 direct construction sites across 87 files reduced to 5 sites across 5 files, each classified with an obligation the guard re-checks
- [x] Zero files reachable from `pnpm test` construct a client outside the boundary — down from 8
- [x] The CI check is an AST + reachability analysis, verified to fail the pre-fix tree and pass this one
- [x] No production credential was used, copied, printed or committed; no production write was made

## The boundary

`packages/db/src/privileged-client-boundary.ts`

```
createPrivilegedClient(url, key, options?, purpose?)   → the sanctioned constructor
assertTargetAllowed({url, key}, purpose, env?)         → for non-Supabase drivers
assertPostgresConnectionAllowed(connStr, purpose, env?)
decideTarget / classifyTarget / classifyKeyRole / detectRestriction
```

The rule is asymmetric on purpose. Making production access conditional on a
positive signal would mean a missing environment variable takes production down.
Making test access conditional on a positive signal means a missing environment
variable merely refuses to run. Only one of those fails in a safe direction, so
the boundary is permissive outside a restricted context and refuses-unless-proven
inside one.

`packages/db/src/target-identity.ts` holds the identity primitives.
`scripts/ci/isolated-proof-attestation.ts` re-exports them, so all seven of its
existing importers — including `assert-staging-target.ts` — resolve to the same
code they did before.

## Inventory

`scripts/ci/privileged-db-client-inventory.json`, regenerable with
`pnpm ci:db-client-inventory`. Every field is derived: sites from the AST,
privilege from whether the file could reach a service-role credential at
`a55de402`, reference from whether anything imports or names the file.

| Classification | Disposition | Files |
|---|---|---|
| writable-privileged | migrated | 38 |
| dead (also privileged, unreferenced) | migrated | 45 |
| writable-privileged | asserted-in-place | 1 |
| writable-privileged | deferred-cross-lane | 1 |
| read-only | unprivileged-direct | 2 |
| behind-the-boundary | is-boundary | 1 |
| **total** | | **88** |

86 of the 88 could reach a service-role credential. The 45 `dead` entries are
also privileged — the classification records that separately rather than letting
"dead" hide it — and were migrated anyway, because "nothing calls it today" is
not a property that stays true.

The five files that still construct directly:

- `packages/db/src/privileged-client-boundary.ts` — is the boundary
- `scripts/ops/db-health-tripwire.ts` — the `postgres` driver, which cannot use
  the Supabase constructor; its connection string is passed through
  `assertPostgresConnectionAllowed` rather than duplicating the rule
- `apps/command-center/src/components/{ApiHealthMonitoring,PipelineLiveRefresh}.tsx`
  — browser components holding an anon key; importing `@unit-talk/db` would pull
  the server data layer into the browser bundle
- `scripts/shadow-scoring-runner.ts` — see "Not closed" below

`apps/command-center/src/lib/data/client.ts` carried a second copy of the
connection builder alongside its own `createClient` call, so the app's behaviour
and `@unit-talk/db`'s could drift with nothing to notice. Both now come from
`@unit-talk/db`; what stays local is the operator-auth precondition, which is
genuinely Command Center's.

## The CI check

`pnpm ci:db-client-boundary` → `scripts/ci/privileged-db-client-guard.ts`.
Runs as its own step in `ci.yml`'s required `verify` job and as the first stage
of `verify:static`, so neither the CI route nor the local route is the one that
skips it. It holds no credential and opens no connection.

It is not a string search. UTV2-1627's attempt here was, and it reported
"enforced" because the string it looked for existed inside code nothing called.

**Rule 1 — AST inventory.** Every module is parsed. A construction site is a
call or `new` whose callee resolves to a binding imported from
`@supabase/supabase-js`, `pg` or `postgres`. A file that mentions `createClient`
in a comment, a string or a regex produces no site; a file that imports it as
`createClient as mk` produces one. Any site whose file is absent from the
inventory fails.

**Rule 2 — each disposition carries a falsifiable obligation.** A classification
alone is a self-declared label, which is the shape of control that failed
before. So: `migrated` requires zero raw sites *and* that the boundary is still
reachable from the file; `asserted-in-place` requires the assertion to be an
argument of the construction call, not merely present in the file;
`unprivileged-direct` requires that no service-role credential appears anywhere
in it; `deferred-cross-lane` requires a named owning issue.

**Rule 3 — reachability from `pnpm test`.** The `test` script is expanded into
its real entrypoints (266 files) and the static import graph is walked. Any raw
construction reachable from it fails regardless of classification. This is the
rule that speaks to the invariant rather than to the presence of text, and it is
the reason the cross-lane deferral below is survivable.

## Verification

```text
$ pnpm verify:static                                    exit 0
  ci:db-client-boundary  OK
  ops:sync-check         OK
  system-alignment       OK
  automation-coverage    OK
  env:check              OK
  lint                   OK
  type-check             OK
  build                  OK
  test                   96 suites, 3929 tests, 3929 pass, 0 fail, 0 skipped
  smart-form verify      OK
  verify:commands        OK

$ pnpm test:db
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL
  exit 1                                    ← correct; this workstation holds no staging credential
```

`pnpm verify` (which appends `test:live-db`) is not runnable here for that
reason, and that refusal is UTV2-1630's deliverable working, not a gap in this
one. The authoritative complete run is the required `verify` context in CI.

The 3929/0 figure is measured on this branch. I did not re-measure the base, so
this proof makes no claim about the delta beyond the 34 tests added here
(17 in `scripts/ci/privileged-db-client-guard.test.ts`, 17 in
`packages/db/src/privileged-client-boundary.test.ts`).

## Evidence — the check verified in BOTH directions

EVIDENCE:

**1. The guard, run against the pre-fix tree and against this branch.** A
worktree at `a55de402` and this working tree, same guard, same inventory:

```text
$ tsx both-directions.ts
PRE-FIX  a55de402   ok=false  sites=93  files=87  findings=92  reachable-from-pnpm-test=8
    raw-in-migrated: 83
    reachable-from-test: 8
    unasserted-site: 1
    reachable: apps/command-center/src/lib/data/client.ts
    reachable: packages/db/src/client.ts
    reachable: scripts/backup-alert-check.ts
    reachable: scripts/db-role-validator.ts
    reachable: scripts/ingestor-alert-check.ts
    reachable: scripts/ops/fix-settlement-utv2-665.ts
    reachable: scripts/ops/ingestor-health-check.ts
    reachable: scripts/prune-provider-offers.ts
FIXED    HEAD        ok=true   sites=5   files=5   findings=0   reachable-from-pnpm-test=0
```

**2. A newly added unclassified constructor fails, and only its removal clears
it.** A two-line file was added to `scripts/`, the guard run, the file removed,
the guard run again:

```text
$ pnpm ci:db-client-boundary        # with scripts/tmp-new-unclassified-constructor.ts present
[db-client-boundary] 6 direct driver construction site(s) across 6 file(s)
[db-client-boundary] unclassified: scripts/tmp-new-unclassified-constructor.ts constructs a
  database client directly (createClient() at line 2 from '@supabase/supabase-js') but is
  absent from scripts/ci/privileged-db-client-inventory.json.
[db-client-boundary] FAILED with 1 finding(s)
exit=1

$ pnpm ci:db-client-boundary        # after removal
[db-client-boundary] 5 direct driver construction site(s) across 5 file(s)
[db-client-boundary] OK
exit=0
```

**3. The runtime boundary, verified in both directions on the same call.**
`createDatabaseClient({env, useServiceRole: true})` with `SUPABASE_URL` set to
production, invoked directly under `tsx --test` — the exact bypass a script
prerequisite cannot cover. The key is the literal string `NOT-A-REAL-KEY`; no
credential is used, because the refusal happens before any socket exists.

```text
# against packages/db/src/client.ts as it stands at a55de402:
ok 1 - PRE-FIX: direct invocation against production succeeds
# PRE-FIX: a service-role client to canonical production was constructed.

# against this branch:
not ok 1 - direct invocation against production
  error: '[db-boundary] REFUSED to open a unidentified connection for @unit-talk/db
    service_role client: target is CANONICAL PRODUCTION zfzdnfwdarxucxtaojxm
    (host=zfzdnfwdarxucxtaojxm.supabase.co, ref=zfzdnfwdarxucxtaojxm,
    restricted-by=NODE_TEST_CONTEXT=child-v8).'
```

**4. Unit suites for both new modules.**

```text
$ tsx --test scripts/ci/privileged-db-client-guard.test.ts        # tests 17 / pass 17 / fail 0
$ tsx --test packages/db/src/privileged-client-boundary.test.ts   # tests 17 / pass 17 / fail 0
```

Both are negative-first. The guard suite builds a synthetic pre-fix tree and
asserts the guard fails it, then the same tree routed through a boundary and
asserts it passes; it also asserts that a `migrated` entry which quietly re-adds
a constructor fails, that a `read-only` exemption is refuted by a service-role
credential in the file, that an assertion present but not applied to the
constructed value fails, and that a decoy file containing `createClient(` only
inside a string and a regex produces no site at all. The boundary suite refuses
23 hostile URL forms including a percent-encoded production host, a trailing-dot
FQDN, a pooler host, a lookalike suffix, and a hostname that merely resolves to
loopback.

**5. `pnpm test` no longer contains the path it used to.** The two worker
runtime tests that construct a real service-role client now fail closed against
the boundary until their fixture states what the test actually needs. The
fixture named `https://example.supabase.co`, which is a remote host the boundary
cannot identify; it is now `http://127.0.0.1:1`. This was the only such site in
the entire suite — measured by running all 16 `test:*` scripts individually
under the strict boundary, which produced exactly two failures, both in that
file.

## Not closed

- **`scripts/shadow-scoring-runner.ts` is not migrated.** UTV2-1629 owns the
  file and has already changed it on its branch, so editing it here would
  collide. It is recorded in the inventory as `deferred-cross-lane` with that
  owner. The deferral buys time and nothing else: it is not reachable from any
  `pnpm test` entrypoint, and rule 3 fails the build unconditionally the moment
  that stops being true. It should be migrated when that lane lands — a one-line
  import change.

- **The two Command Center browser components remain direct.** They are anon-key
  only and the guard re-checks that premise every run, but the exemption is real:
  if someone gives one of them a service-role key the guard fails, yet nothing
  stops a *new* browser component from being added with the same exemption
  through a reviewed inventory entry.

- **The boundary governs construction, not the environment.** A process that is
  neither under node:test nor flagged `staging-only` may still reach production
  with a service-role key — that is production runtime, and it must. This lane
  closes the path from the test suite; it does not and should not make
  production unreachable.

- **`referenced` in the inventory, and therefore the `dead` bucket, is a
  heuristic.** It counts imports, npm scripts, workflows and doc mentions. It
  cannot see a script invoked by hand from a shell or a runbook that does not
  name the path. Nothing enforces on it — all 45 were migrated regardless — but
  the count should not be read as a deletion list.

- **Duplicate production-ref constants remain outside the boundary.**
  `scripts/backup/{restore-verify,restore-drill,rollback-validate}.ts`,
  `scripts/benchmarks/queue-throughput.ts` and
  `scripts/utv2-phase9-schema-reconciliation.ts` each declare their own copy of
  `zfzdnfwdarxucxtaojxm`. They are guards rather than constructors so they are
  out of this lane's scope, but they are five more places that would have to be
  updated if the production ref ever changed.
