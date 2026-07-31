# PROOF: UTV2-1630
MERGE_SHA: a55de4025f966ce458546a16b5d91faa7b5e034b

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
- [x] No pull-request-reachable job holds a production Supabase credential except three read-only consumers, each named with a reason, re-validated against the live workflow, and — where it executes PR-authored code — gated so the pull request cannot run its own version
- [x] Every job using a `CI_SUPABASE_*` secret binds `environment: staging-ci`, enforced by the same scanner
- [x] The scanner resolves the workflow_call graph and scans whole documents, so workflow-level env, bracket-indexed secrets and `secrets: inherit` cannot evade it
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

EVIDENCE:

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

The measurement below is from the **full writable set** — `pnpm test:db` plus
`pnpm test:t1-proof:live`, fifteen further suites. That is the exact command
chain that wrote 1,036 picks and 943 submissions to production across
2026-07-29/30.

```text
production zfzdnfwdarxucxtaojxm
  picks       107858 -> 107858   newest 2026-07-30 20:14:57.722+00 (unchanged)
  submissions 107428 -> 107428   newest 2026-07-30 20:14:57.722+00 (unchanged)

staging xskgrzbteyqdufktjrjx
  picks       141                newest 2026-07-30 21:22:20.069+00
  submissions  55                newest 2026-07-30 21:22:20.378+00
  reference    sports 9 · cappers 1 · market_families 6 · selection_types 3 · market_types 133
```

The writes landed in staging. Production received none. `20:14:57.722+00` is the
last row of the incident that preceded this lane; nothing has been appended
since, across every CI run of this lane.

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

## Adversarial review findings and disposition

An independent exact-head review was run against this branch with a brief to
**refute** the central claim. It could not refute the narrow claim — the
writable script paths and the four migrated workflows are genuinely
staging-pinned, and the URL guard survived 23 hostile hostname forms with zero
false approvals. It did refute the claim as originally worded, and found three
defects this lane had introduced. All are closed here.

| # | Finding | Disposition |
|---|---|---|
| P0 | `shadow-parity-required.yml` and `live-schema-parity.yml` run PR-authored code with a production credential; their exemptions rested on script behaviour the PR can rewrite | **Fixed** — both gated on `assert-unmodified-vs-base.ts`; a PR that edits the executed script cannot run its own version |
| P1 | `required-db-smoke.ts` still used the fail-open `endsWith` entrypoint guard | **Fixed** — `realpathSync`; plus a test that enforces the pattern across all six writable CLIs |
| P1 | `verify` `needs:` producer → a FAILED producer makes the required check `skipped`, not red | **Fixed** — `if: always()` plus an explicit first-step assertion on `needs.staging-db-proof.result` |
| P1 | `test:t1-proof:live` (15 writable suites) lost all CI coverage in the restructure | **Fixed** — runs in `staging-db-proof` |
| P1 | Scanner evaded by workflow-level `env`, bracket indexing, `secrets: inherit`, and `workflow_call` callees | **Fixed** — whole-document scan, both accessor forms, call-graph resolution; one test per class |
| P1 | `pnpm verify` unrunnable anywhere, so the pre-closure checklist's step 1 is unsatisfiable | **Partially fixed** — `verify:local` added. The CLAUDE.md wording is a governance-doc change and is deliberately left to its own lane rather than edited from inside this one |
| P2 | `proof-gate.yml` `runtime-verifier` bound `staging-ci` on a false premise | **Fixed** — binding removed; it holds no DB credential |
| P2 | Docblock claimed unbound `CI_SUPABASE_*` always yields empty strings | **Fixed** — four of those names also exist as repository-level secrets (UTV2-1627 leftovers), making the failure partial rather than total. Corrected in the docblock; deleting the orphans is left as follow-up |
| P2 | `supabase-pr-db-branch.yml`'s `pnpm test:db` cannot pass against a preview branch | **Not fixed** — dormant (`SUPABASE_BRANCHING_ENABLED` unset). Recorded rather than silently left |
| P2 | Receipt is anti-accident, not anti-tamper | **Claim narrowed**, see below |

### The claim, narrowed to what is actually proven

The receipt's `receipt_sha256` is keyless, and both producer and verifier are
defined by `ci.yml`, which a pull request supplies. A PR that rewrites the
producer could mint a valid receipt without opening a database. Branch
protection does not currently require code-owner review, so this is not closed
mechanically.

The honest statement is therefore: **no CI job can accidentally reach
production, and no pull request can reach production without visibly rewriting a
workflow file owned by CODEOWNERS.** Making that last clause mechanical requires
enabling `require_code_owner_reviews` on `.github/**` — a branch-protection
change, which this lane is explicitly forbidden from making. It is recorded as
the top follow-up.

## Known limitations

- `Live Schema Parity` is red on this PR and is **pre-existing**: 80 drift items
  between repo migrations and the live schema, tracked as the migration-ledger
  drift under UTV2-1274. This lane touches no migration. It is not a required
  context.
- `Readiness Regression Gate` is red and **pre-existing**: `readiness-score.json`
  is 351 hours stale and its verdict is RED on `deploy_sha_alignment`,
  `ingestor_health`, `worker_outbox_health` and `dead_letter_count` — production
  runtime state, none of which this diff touches. It is not a required context.
  It is deliberately left red: making it green would mean writing a readiness
  score this lane has not measured.
- The production `picks` table is ~93% test fixtures accumulated since
  2026-04-21 (100,247 of 107,858 rows carry a fixture marker). This lane stops
  the source; it deletes nothing. An exact-ID inventory of the 1,036 picks and
  943 submissions written since containment was produced read-only, and cleanup
  is deliberately deferred until this change is on `main`.

## Runtime proof harvest (closeout)

`ops:truth-check` R1/R2/R3/P10 require the evidence bundle to carry the live
queries, the observed row counts, and a verifier identity distinct from the
lane's `created_by`. Those facts existed the whole time inside the CI receipt
this lane produced; they had simply never been copied into `evidence.json`.
They were read back on 2026-07-31 from the retained artifacts of the original
run and are now recorded under `runtime_proof`:

| Fact | Source |
|---|---|
| 7 live `pnpm test:db` cases against staging `xskgrzbteyqdufktjrjx` | `ci-db-proof-receipt/v2` `captured_output`, artifact `8775492252` (`utv2-1630-db-proof-receipt-30583207418-1`) |
| 5 reference-table upsert counts on staging | job log, run `30583207418` job `91008556141` (`Writable DB proof (staging only)`), `[seed-staging]` lines |
| 96 tests / 96 pass / 0 fail / 0 skipped across 16 TAP blocks | same job log — `pnpm test:db` plus `pnpm test:t1-proof:live` |
| Verifier verdict `PASS` | job log, run `30583207418` job `91008917481` (`verify`): `DB proof verified: run 30583207418 attempt 1 @ d75643c1ae782aa54cef1c6a22373c7a72a493ff, target xskgrzbteyqdufktjrjx, pass=7 fail=0 skipped=0` |

Nothing was re-executed to satisfy the gate. A fresh run would be a different
measurement wearing this merge SHA's name, which is the precise defect this
lane exists to eliminate. The seeder in that run reported only reference-data
upserts and no reset/delete counts, so none are claimed.

`ops:truth-check UTV2-1630` then returns `VERDICT: pass (43 checks, 0 failures)`
and `ops:lane-close UTV2-1630` exits 0 with an empty failure list.
