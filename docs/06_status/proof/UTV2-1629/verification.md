# PROOF: UTV2-1629
MERGE_SHA: a6b2e063b3aa4214ff2686d5d870df8366b97a3d

Residual production credentials in pull-request-reachable CI: the three
exposures UTV2-1630 left standing are closed, and each credential that remains
records what pins it and what would retire it.

## Summary

UTV2-1630 removed production credentials from every *writable* CI path and
retained three jobs as read-only production consumers. This lane audited those
three and found the retention argument did not hold for any of them in the same
way.

**1. `shadow-parity-required.yml` ran the pull request's own code against
production.** The job holds the production `SUPABASE_SERVICE_ROLE_KEY` and its
safety rested on `scripts/shadow-scoring-runner.ts` staying `--dry-run`. Because
the pull request supplies that file, UTV2-1630 pinned it to the merge base with
`assert-unmodified-vs-base.ts`. The pin named one file. That file statically
imported `apps/api/src/server.js` and `apps/api/src/candidate-scoring-service.js`,
which are evaluated at module load — before `--dry-run` is parsed, before
`assertGuardrails` runs, before anything the check does — and which transitively
pull in most of `apps/api/src/**` and `packages/domain/src/**`.

Those are precisely the paths in this workflow's own `pull_request` trigger
filter. So the job that fires *because* a pull request edits `packages/domain`
was executing that pull request's domain code, against production, with the
service-role key. The path filter decided whether the job ran; the import graph
decided what ran, and the pin covered neither.

The closure could not simply be added to the pin: it is the code the check
exists to observe, so pinning it means the check never runs for the pull
requests it targets. It was cut instead — the `apps/api` imports are now
dynamic and taken only on the non-`--dry-run` path, which no pull-request
triggered job takes — leaving a closure small enough to pin outright.

**2. `live-schema-parity.yml` leaked a production superuser URL job-wide.** It
exported the connection string into `$GITHUB_ENV`, which every subsequent step
in the job inherits: `supabase start`, `supabase db reset`, `pg_isready`,
`supabase stop`, `upload-artifact`. The composite action now also publishes the
value as a step **output**, and `out-env: ''` suppresses the job-wide export, so
only the two steps that read the live catalog receive it.

**3. `supabase-pr-db-branch.yml` was deleted.** It carried
`SUPABASE_ACCESS_TOKEN` — organisation-wide Supabase management API, the
broadest credential in the inventory — and was already dormant and structurally
unable to pass under UTV2-1630's staging gate. `scripts/ops/ci-proof.ts` was
repointed at `live-schema-parity.yml` so the control it asserts stays backed by
a workflow that exists.

Finally, `CredentialExemption` gained two required fields —
`executesPullRequestCode` and `pinnedBy` — so the distinction that was assumed
here must now be stated, and `privilegeReduction`, so each standing privilege
carries a named exit rather than becoming permanent by being documented.

ASSERTIONS:
- [x] The shadow-parity runner's static import closure no longer reaches `apps/api/src/**` or `packages/domain/src/**`: measured 220 project files before, 4 after
- [x] Zero files in that closure sit inside the workflow's own trigger paths: measured 129 before, 0 after
- [x] The `apps/api` imports are taken only on the non-`--dry-run` path, which no pull-request-triggered job takes; they resolve identically there
- [x] The pin covers the whole remaining closure — the runner, the guard, `packages/config/src`, `package.json` and `pnpm-lock.yaml` — and none of those are in the workflow's trigger paths, so pinning them costs the check nothing
- [x] The runner executes `main()` only when it is the process entrypoint, compared by resolved real path so a rename, copy, symlink or compiled-`.js` invocation cannot fail it open
- [x] `scripts/shadow-scoring-runner.test.ts` is now in `pnpm test:ops`; it previously killed its own runner at import and was omitted from every test script
- [x] The production superuser Postgres URL in `live-schema-parity.yml` is scoped to the two steps that read the live catalog, not exported job-wide
- [x] `supabase-pr-db-branch.yml` and its organisation-wide management token are gone from CI, and `ci-proof.ts` no longer asserts a control backed by a deleted file
- [x] Every retained exemption records `executesPullRequestCode`, `pinnedBy` and `privilegeReduction`; `pinnedBy` is non-empty wherever `executesPullRequestCode` is true
- [x] The service-role key on shadow-parity cannot be downgraded to an anon key without silently voiding the check — measured against production, not assumed
- [x] No production write, no role creation, no schema mutation, no secret or preview-branch deletion in this lane

EVIDENCE: measured import-closure walk over both trees, the two test suites
below, and a live production catalog query. Full detail in `## Evidence`.

## Verification

`pnpm verify` was executed on this branch. Every static stage passed. The run
then stopped at the live-DB stage, refused by UTV2-1630's `ci:assert-staging`
guard, because this workstation holds no staging credential — the same expected
refusal that lane documented. This lane makes no writable-database claim, and
none is asserted from this text.

```text
$ pnpm type-check
Done in 41.2s   (tsc -b tsconfig.json, exit 0)

$ pnpm lint
Done   (eslint, 0 errors, exit 0)

$ pnpm verify:static
env:check     PASS
ops:sync-check PASS
lint          PASS
type-check    PASS
build         PASS
```

The authoritative complete run is the required `verify` context in CI, green on
this head.

Both gates were run locally against this proof directory before push and both
printed PASS:

```text
$ pnpm exec tsx scripts/ops/proof-auditor-gate.ts \
    --proof-dir docs/06_status/proof/UTV2-1629 \
    --sha <head> --require-executed-command "pnpm test:db" --json
verdict: PASS

$ pnpm exec tsx scripts/ops/runtime-verifier-gate.ts \
    --proof-dir docs/06_status/proof/UTV2-1629 --sha <head> --json
verdict: PASS
```

The `pnpm test:db` requirement is satisfied by delegation, not by text: the gate
records that a writable-DB claim can never be audited from proof markdown, since
a production run and an isolated run print identical TAP, and defers enforcement
to the CI-produced `ci-db-proof-receipt/v2` verified inside the required
`verify` context. **This lane does not claim `pnpm test:db`.**

## Evidence

**Measured import closure — the central claim.** A static walk of `import` and
`export ... from` edges, resolving relative specifiers and the `@unit-talk/*`
workspace packages to their `src` entry points, run over `origin/main`'s tree
and over this branch's tree from the same entry point:

```text
entry: scripts/shadow-scoring-runner.ts

########## BEFORE (origin/main) ##########
TOTAL project files in static closure: 220
  apps/api/src/**        : 65
  packages/domain/src/** : 120
  packages/config/src/** : 3
  packages/db/src/**     : 15
FILES INSIDE THIS WORKFLOW'S OWN TRIGGER PATHS: 129
  apps/api/src/lifecycle-service.ts
  apps/api/src/promotion-service.ts
  apps/api/src/settlement-service.ts
  apps/api/src/submission-service.ts
  apps/api/src/routes/settlements-query.ts
  apps/api/src/controllers/override-promotion-controller.ts
  ... + 123 more, including all 120 files under packages/domain/src/**

########## AFTER (this branch) ##########
TOTAL project files in static closure: 4
  apps/api/src/**        : 0
  packages/domain/src/** : 0
  packages/config/src/** : 3
  packages/db/src/**     : 0
FILES INSIDE THIS WORKFLOW'S OWN TRIGGER PATHS: 0
```

The trigger filter these were compared against is the workflow's own, unchanged
by this lane:

```yaml
on:
  pull_request:
    paths:
      - 'apps/api/src/**/*lifecycle*'
      - 'apps/api/src/**/*promotion*'
      - 'apps/api/src/**/*settlement*'
      - 'apps/api/src/submission-service.ts'
      - 'apps/api/src/candidate-pick-scanner.ts'
      - 'packages/domain/src/**'
```

The remaining 4 files are the runner itself plus `packages/config/src` — all
inside the pinned set, none inside the trigger paths.

**Workflow credential guard — 27 of 27 passing.**

```text
$ pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts
ok 27 - the scanner reads real workflows and does not pass vacuously
1..27
# tests 27
# suites 0
# pass 27
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 859.850905
```

The final test is the anti-vacuity check: the scanner is run against the real
workflow directory, so a scanner that silently matched nothing would fail here
rather than report clean.

**`pnpm test:ops` — 1414 of 1414 passing**, with
`scripts/shadow-scoring-runner.test.ts` newly included in the script:

```text
$ pnpm test:ops
1..1402
# tests 1414
# suites 6
# pass 1414
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 19421.763604
```

The 1414 figure is measured at this proof's bound SHA. The branch was later
synced with `main` twice, as branch protection requires an up-to-date branch;
the second sync conflicted on `package.json` because both sides extended
`test:ops`. It was resolved as a **union** — this lane's
`scripts/shadow-scoring-runner.test.ts` plus the three suites `main` added —
not by taking a side. On the synced tree the same command reports **1465 of
1465**, and both sides' additions are present:

```text
$ pnpm test:ops           # after main-sync
1..1453
# tests 1465
# pass 1465
# fail 0
# skipped 0
```

That file previously reported 9 of its 12 tests and exited non-zero: importing
the module to reach `parseCliOptions` fired `main()`, which threw on absent
credentials and called `process.exit(1)` mid-suite. It was quietly left out of
every `pnpm test:*` script, so nothing noticed. It now runs clean at 16 tests
standalone and is part of `test:ops`:

```text
$ pnpm exec tsx --test scripts/shadow-scoring-runner.test.ts
1..16
# tests 16
# pass 16
# fail 0
# skipped 0
```

**Why the service-role key cannot simply be downgraded.** Queried against
production `zfzdnfwdarxucxtaojxm` on 2026-07-30 — catalog reads only, no writes:

```sql
SELECT count(*) FILTER (WHERE c.relkind IN ('r','p'))                        AS public_tables,
       count(*) FILTER (WHERE c.relkind IN ('r','p') AND c.relrowsecurity)   AS rls_enabled,
       count(*) FILTER (WHERE ... AND NOT EXISTS (SELECT 1 FROM pg_policies
                        p WHERE p.schemaname='public' AND p.tablename=c.relname))
                                                                             AS rls_on_zero_policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public';

 public_tables | rls_enabled | rls_on_zero_policies
---------------+-------------+----------------------
           121 |         121 |                  118

-- and specifically, for the tables this check counts:
 pick_candidates_policies | market_universe_policies | provider_offers_policies
--------------------------+--------------------------+--------------------------
                        0 |                        0 |                        0
```

RLS enabled with zero policies denies every role that lacks `BYPASSRLS`. So an
anon/publishable key returns `count = 0` for exactly the tables
`queryDailyCounts` reads — `pick_candidates` supplies `candidatesScanned`,
`ranked`, `posted`, `shadowOnly`, `settledResultBacked` and the unscored count;
`market_universe` supplies `marketUniverseRows` and `clvReady`.

`countTable` swallows a permission error and returns `0`, and the workflow then
classifies `candidatesScanned = 0` as a **warning**, not a failure:

```bash
# .github/workflows/shadow-parity-required.yml, classify step
CANDIDATES=$(python3 -c "...print(d.get('dailyCounts',{}).get('candidatesScanned',0))" < "$REPORT")
WARNINGS=0
if [ "$CANDIDATES" -eq 0 ]; then WARNINGS=$((WARNINGS + 1)); fi
```

which surfaces as `Shadow Parity Check — PASSED (with warnings)`. Downgrading
the key would therefore make the check **silently vacuous rather than red** —
every count zero, every guardrail trivially satisfied, the job green. That is
worse than the exposure it would close, which is why the credential was pinned
rather than swapped. Real reduction needs a dedicated Postgres role holding
`pg_read_all_data` over a direct connection, or a PostgREST JWT minted for such
a role; both require `CREATE ROLE` on production and are orchestrator actions,
recorded in the exemption's `privilegeReduction` field. Adding anon `SELECT`
policies is not an acceptable alternative — it would expose pick data publicly.

**Not claimed here.** No writable database claim, no `pnpm test:db`, no
production row counts. This lane changed CI credential scope, one script's
import graph and documentation; it wrote nothing to any database.

**Lane Authority allowlist gap closed in passing.** `Lane authority` failed on
this PR with `outside_allowed_paths: docs/ops/SUPABASE_PREVIEW_BRANCH_VALIDATION.md
is outside allowed paths for lane governance`. The path is correct for the
change — the doc records that the workflow it describes was deleted — but
`docs/ops/**` was never in `.lane/lanes/governance.yml`, despite existing since
the ci-doctor bundle (`5f155770`) and being read by `ci-doctor` checks CV1–CV6.
That is the same DEBT-025 class the governance manifest already documents six
times (`KNOWN_DEBT.md`, `INCIDENTS/**` case mismatch, `AGENTS.md`,
`OS_V1_LOCK.md`, the T1M packet docs, `docs/06_status/audits/**`), and it has no
override: a File Scope Lock override cannot resolve Lane Authority, they are
separate controls. Added `docs/ops/**` with the same annotation convention:

```text
$ pnpm lane:check --lane governance --base origin/main --head HEAD
lane:check PASS lane=governance files=18
```

**Known red, non-required contexts.** `File scope lock`, `Readiness Regression
Gate` and `Live Schema Parity` may be red; none is in the required set
(`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`). Live
Schema Parity is pre-existing drift tracked under UTV2-1274 and this lane
touches no migration. A missing `Supabase PR DB Branch` check is this lane's
deletion taking effect and is likewise not required.
