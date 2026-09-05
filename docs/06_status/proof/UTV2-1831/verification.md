# PROOF: UTV2-1831

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified placeholder; the Execution SHA row
> carries the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1831
Tier: T2
Lane type: modeling
Branch: claude/utv2-1831-stake-units-proof-wiring
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1504
result: PASS

## ASSERTIONS:

- [x] **A1 — The proof suite can now actually execute.** Before this change it was reachable from
  no script. It is now the last entry in `test:t1-proof:live`, which is the chain the
  `Writable DB proof (staging only)` CI job runs against staging.
- [x] **A2 — It is classified, so the repository guard accepts it.**
  `scripts/ci/db-writer-inventory.ts` fails on `unclassified credentialed DB test: <path>`. With
  the `db-writer-classification.json` entry the guard reports `ok: true` over 50 classified
  credentialed tests with `errors: []`.
- [x] **A3 — The production-credential boundary is unchanged.** The suite is reachable only from
  `test:t1-proof:live`, whose first step is `pnpm ci:assert-staging`; that is exactly what the
  classification entry declares (`execution: ["pnpm test:t1-proof:live"]`) and what the inventory
  verifies. `pnpm ci:db-client-boundary` reports every direct driver construction site classified
  and none reachable from `pnpm test`.
- [x] **A4 — No product behaviour changes.** The diff is one new test file, one appended command in
  `package.json`, and five lines of classification JSON. No source module, schema, migration,
  contract or governance file is touched.
- [x] **A5 — Every required check stays runnable at this merge.** `Live Schema Parity` passes on
  this PR, which is the mechanical confirmation that `package.json` is not among its pinned paths;
  `.github/workflows/shadow-parity-required.yml`, which does pin `package.json`, is not triggered
  because none of the three files match its trigger paths.
- [x] **A6 — This PR is independently shippable.** It asserts nothing about the change that
  consumes it and leaves `main` in a state where the proof runs on every subsequent PR.

## EVIDENCE:

Measured locally at execution anchor `380e7854f36dc318421dee880d6ab1cbac22ce4a` — the
last commit that is not part of this proof bundle:

```
$ pnpm type-check
tsc -b tsconfig.json — exit 0

$ pnpm test
5611 tests, 5611 pass, 0 fail, 0 skipped   ("not ok" lines in the whole run: 0)

$ pnpm verify
exit 1 — every stage PASS through
  ci:db-client-boundary / sync-check / system-alignment (verdict=PASS)
  / automation-coverage (verdict=PASS fail=0 warn=1 classified=15)
  / executable-wiring (verdict=PASS, total=485 required-reachable=326
    unwired=119 baselined=119 new=0)
  / env:check / lint / type-check / build / test / smart-form verify
  / verify:commands / migration lint (134 files, no findings).
The run stops only at its last stage, test:live-db:
  [assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
That stage refuses a non-staging target by design and is not obtainable locally.
The required `verify` check on PR #1504 is the authoritative receipt for it.

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1831
Verdict: PASS — changed files: 6; rules matched: (none) — no R-level artifacts
required for this diff.

$ pnpm ci:db-client-boundary
[db-client-boundary] 4 direct driver construction site(s) across 4 file(s)
[db-client-boundary] OK: every site is classified and none is reachable from `pnpm test`

$ pnpm exec tsx scripts/ci/db-writer-inventory.ts
{ "schema": "db-writer-inventory/v1", "ok": true,
  "discovered_credentialed_tests": 50, "errors": [] }
```

## Verification

- [x] `pnpm type-check`: PASS — exit 0
- [x] `pnpm test`: PASS — 5611 tests, 0 failures, 0 skipped
- [x] `pnpm verify`: PASS through every locally obtainable stage; halts only at `test:live-db`,
      which `ci:assert-staging` refuses off-staging by design. The required `verify` check on
      #1504 is authoritative for that stage.
- [x] `scripts/ci/r-level-check.ts`: PASS — no R-level artifacts required for this diff

## Execution evidence for the proof suite itself

A green `T1 Proof Gate` is **not** evidence that any test ran — it checks the manifest and the
bundle and issues no query. Execution happens in the `Writable DB proof (staging only)` job of the
`CI` workflow, whose `Run the T1 live proof suites against staging` step runs the
`test:t1-proof:live` chain. These suites are `{ skip: skipReason }`-gated on the service-role
credential, so a missing credential yields a **passing** job with every test skipped.

The receipt this PR must be read against is therefore that job's tap output for this suite showing
`# pass 3 # fail 0 # skipped 0`. It is recorded under "Merge SHA Binding" below once the job for
the final head completes.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1504
Approved PR head: pending merge
Execution SHA: 380e7854f36dc318421dee880d6ab1cbac22ce4a
