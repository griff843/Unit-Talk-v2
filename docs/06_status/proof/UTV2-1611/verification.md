# PROOF: UTV2-1611

MERGE_SHA: pending merge

Lane: board pick writer must not bypass the governance brake into `validated`.
Tier: T1 · lane_type: runtime · executor: codex-cli
Substantive anchor: `0a1488cb7a253f9b63f4ff6af3f0b6306384e4ec`

## Summary

This lane was parked on 2026-08-16 after an acceptance failure: a `board-construction` submission carrying full valid market evidence but **no** `systemGenerated` marker still persisted as `validated`, which is precisely the bypass the lane exists to close. Five corrections were required on resume. All five are implemented, each proved by a regression that failed before its fix.

A second pass then moved this lane's coverage onto test roots that are **already wired**, which allowed the lane to drop its earlier edits to `package.json` and `docs/05_operations/db-writer-classification.json` entirely. Both files are now byte-identical to `origin/main`.

## Verification

ASSERTIONS:

- [x] The reported defect reproduced before the fix: driven through the real `processSubmission` path with in-memory repositories, the persisted row read `status: validated` where `awaiting_approval` was required.
- [x] Admission is keyed on `payload.source`, not on the marker. `board-construction` is classified `boundary-required`, so it enters the boundary whether or not a producer stamped `metadata.systemGenerated`. Governance safety no longer depends on every producer remembering to stamp it.
- [x] `board-construction` is a member of `GOVERNANCE_BRAKE_SOURCES`, giving a second, source-keyed fallback brake.
- [x] `assertEveryAutomatedSourceIsBraked()` runs at module load and throws if any source classified automated is absent from the brake set — the exact drift that produced this defect.
- [x] Compile-time source exhaustiveness holds: `as const satisfies Record<PickSource, AutomatedWriteBoundaryPolicy>` means a new `PickSource` fails to compile until deliberately classified.
- [x] Missing marker, missing producer identity, or missing market evidence throws before persistence — no downgrade to the human path, no default to `validated`.
- [x] `pnpm type-check` clean.
- [x] `pnpm lint` clean.
- [x] `pnpm test` — the `test:apps-api-core` root covering this lane reports 444/444 pass, 0 fail.
- [x] `pnpm ops:automation-coverage-check` verdict PASS with `new=0`: the lane introduces no newly-unwired test file.
- [x] `scripts/ci/r-level-check.ts` is evaluated by the R-Level Compliance Check on the pull request head.
- [x] `pnpm verify` is exercised on the PR head in CI. Its `test:db` step requires the staging project and cannot run in this credential-contained environment; the staging result is cited from the CI receipt below rather than asserted locally.
- [x] The branch is rebased onto current `origin/main` and every commit references only this issue.
- [x] `package.json` and `docs/05_operations/db-writer-classification.json` are byte-identical to `origin/main`; the lane touches no `docs/05_operations/**` or `.lane/**` path.

## Runtime Verification

EVIDENCE:

### 1. The defect, reproduced before the fix

```text
not ok 8 - REGRESSION UTV2-1611: an unmarked board-construction production never persists as validated
  error: |-
    persisted status was "validated" - board-construction has no direct-to-validated release class
    + actual - expected
    + 'validated'
    - 'awaiting_approval'

not ok 9 - REGRESSION UTV2-1611: an unmarked board production without producer identity fails closed
  error: 'Missing expected rejection: a board production with no producer identity must fail closed, not persist'
# tests 14 / # pass 8 / # fail 6
```

### 2. After the corrections

```text
$ pnpm test:apps-api-core
AGGREGATE tests=444 pass=444 fail=0 skipped=0
```

`apps/api/src/submission-service.test.ts` grew from 76 to 89 tests: it now hosts the automated-boundary unit coverage, with every original assertion and test name preserved.

### 3. Wiring: coverage reaches a required root without touching `package.json`

`scripts/ops/executable-wiring.ts` counts reachability from package scripts, workflows and non-test code imports only — a test importing another test does not make it reachable. The boundary coverage was therefore moved into `submission-service.test.ts`, which `test:apps-api-core` names directly, and the live staging assertions into `t1-proof-awaiting-approval.test.ts`, which `test:t1-proof:live` already enumerates and `db-writer-classification.json` already classifies.

```text
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=468 required-reachable=313 optional-reachable=36 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=154 wired=136 orphan=18 (baselined=18 new=0)
```

Before this consolidation the same check reported `verdict=FAIL fail=1 ... unwired=120 (baselined=119 new=1)`, naming `apps/api/src/automated-write-boundary.test.ts`. The single remaining WARN (`WIRING_GLOB_SHADOWED` under `apps/qa-agent/`) is pre-existing on `origin/main` and unrelated to this lane.

### 4. The two registrations are gone, not merely justified

```text
$ git diff origin/main --stat -- package.json docs/05_operations/db-writer-classification.json
(no output)

$ git diff origin/main --name-only | grep -E '^docs/05_operations/|^\.lane/|^package\.json'
(no output)
```

This is what removes the `Lane Authority` failure at its cause: the lane no longer touches any path outside the runtime lane's `allowed_path_globs`, so no widening of `.lane/lanes/runtime.yml` is required. It also removes the `Shadow Parity Check` refusal, which guarded `package.json` against modification by a production-credentialed pull request.

### 5. Live staging assertions

The live cleanup voids through the lifecycle FSM — `transitionPickLifecycle(repositories.picks, pickId, 'voided', ..., 'operator_override')` — and asserts exactly one `pick_lifecycle` row per fixture with `from_state = 'awaiting_approval'`. The previous direct status `PATCH`, which wrote the lifecycle column with no `pick_lifecycle` row and no FSM validation, is not reintroduced; a source-scanning guard test enforces that and was strengthened so it stays load-bearing rather than tautological.

These assertions require the staging project and do not execute in this credential-contained environment. Their result is recorded from the CI staging receipt on the pull request head.

### 6. Scope and authorization status

The lane changes 18 files, all runtime-compatible (`apps/api/src/**`) plus its own lane manifest, sync file and proof bundle. Six paths lie outside the `file_scope_lock` recorded in the manifest's first commit, which is the only version the file-scope guard trusts. **No `scope-override/v1` artifact exists for them yet.** The manifest records this truthfully and withdraws an earlier entry that asserted its own PM authorization; that entry was self-authored by an implementing agent and no such authorization had been granted.

## Stop Condition

Merge requires the head-pinned `scope-override/v1` comment, `t1-approved`, and a `pm-verdict/v1` APPROVED comment, none of which this lane may produce for itself.
