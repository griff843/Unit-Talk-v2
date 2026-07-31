# PROOF: UTV2-1604

MERGE_SHA: f74021c9ba714cf407eaffd1070de9a286cea1c1

## Summary

UTV2-1604 implements one explicit syndicate-machine mode contract across
configuration, API scheduler registration, deploy validation, canary,
production, and post-start container assertions:

- exact `true` selects `active`;
- exact `false` selects `parked`;
- missing, empty, case-variant, padded, or other values fail closed.

In parked mode, board scan, candidate scoring, ranked selection, board
construction, board pick writer, and candidate pick scanner are suppressed.
The runtime receipt is emitted after registration callbacks and separates
policy eligibility from whether each scheduler actually started.

This is implementation evidence only. It does not claim that a GitHub secret
was created or changed, that a deployment occurred, that a deployed SHA was
observed, or that production readiness is GREEN. Those actions remain
Griff-reserved.

## Assertions

ASSERTIONS:

- [x] `SYNDICATE_MACHINE_ENABLED` resolves only from exact `true` (active) or
      exact `false` (parked); missing, empty, case-variant, or padded values
      throw and refuse boot.
- [x] Parked mode suppresses registration of all six producer stages:
      board-scan, candidate-scoring, ranked-selection, board-construction,
      board-pick-writer, candidate-pick-scanner.
- [x] Parked mode still registers the eight non-producer schedulers.
- [x] `BOARD_PICK_WRITER_ENABLED` can no longer force the board pick writer on
      while the syndicate machine is parked.
- [x] Active mode preserves registration of every production scheduler.
- [x] The runtime receipt is emitted after registration callbacks and
      distinguishes policy eligibility from whether a scheduler actually
      started; it is not a hardcoded active receipt.
- [x] `deploy.yml` validates the mode once and propagates the validated value
      through canary and production; both stages assert the container's runtime
      value equals the requested value.
- [x] All fourteen production schedulers are explicitly classified; an
      unclassified scheduler fails the classification suite.
- [x] This lane performed no production deployment, secret creation, service
      restart, schema mutation, or row deletion.

## Verification

### Canonical parked-mode safety suites

Command:

```text
npx tsx --test scripts/ci/deploy-parked-mode.test.ts scripts/ci/scheduler-classification.test.ts apps/api/src/scheduler-policy.test.ts packages/config/src/env.test.ts
```

Result (re-measured on the origin/main-rebased head):

```text
1..31
# tests 31
# pass 31
# fail 0
# skipped 0
# duration_ms 4131.456023
```

Coverage includes:

- exact active/parked parsing and fail-closed invalid values;
- all fourteen production schedulers classified;
- all six producer stages suppressed in parked mode;
- active behavior preserved;
- truthful eligible/started/skipped outcomes;
- workflow value propagation from validation through canary and production;
- requested/runtime container equality;
- no hardcoded active receipt;
- removal mutations for three producer gates;
- unclassified scheduler mutation;
- removal mutations for all three required test-command entries.

### Runtime policy receipt

Command:

```text
npx tsx -e "<run all production scheduler ids through createSchedulerRegistrationPolicy for false and true>"
```

Parked receipt:

```json
{
  "requestedValue": "false",
  "mode": "parked",
  "started": 7,
  "skipped_by_runtime_condition": [
    {
      "scheduler": "system-pick-scanner",
      "reason": "SYSTEM_PICK_SCANNER_ENABLED=false"
    }
  ],
  "suppressed_by_mode": [
    "board-scan",
    "candidate-scoring",
    "ranked-selection",
    "board-construction",
    "board-pick-writer",
    "candidate-pick-scanner"
  ]
}
```

Active receipt:

```json
{
  "requestedValue": "true",
  "mode": "active",
  "eligible": 14,
  "started": 13,
  "skipped_by_runtime_condition": [
    {
      "scheduler": "system-pick-scanner",
      "reason": "SYSTEM_PICK_SCANNER_ENABLED=false"
    }
  ],
  "suppressed_by_mode": []
}
```

This proof calls the policy directly; it does not start the API or any
production scheduler.

### Existing deploy regressions

Command:

```text
npx tsx --test scripts/deploy-check.test.ts scripts/ops/workflow-hardening.test.ts scripts/ci/ops-p0-containment-workflow.test.ts
```

Result (re-measured on the origin/main-rebased head):

```text
1..73
# tests 73
# pass 73
# fail 0
# skipped 0
# duration_ms 3654.657095
```

### Full repository static gate

Command (run in the lane worktree on the origin/main-rebased head):

```text
pnpm verify:static
```

Result: PASS, exit code 0. This covers `ci:db-client-boundary`,
`ops:sync-check`, `ops:system-alignment-check`, `ops:automation-coverage-check`,
`env:check`, `lint`, `type-check`, `build`, `test` (which now includes
`scripts/ci/scheduler-classification.test.ts`,
`scripts/ci/deploy-parked-mode.test.ts`, and
`apps/api/src/scheduler-policy.test.ts` via the wired `test:apps-api-core` and
`test:ops` entries), the smart-form workspace verify, and `verify:commands`.
No suite reported a non-zero fail count.

### Live-database gate

`pnpm verify` is `pnpm verify:static && pnpm test:live-db`. Under UTV2-1630 the
live-database half is no longer runnable from a developer checkout: `test:db`
begins with `pnpm ci:assert-staging`, and this worktree holds no staging
credential, so a local invocation fails closed by design rather than reaching
any database. This lane therefore did not run `pnpm test:db` locally and makes
no local live-database claim.

The authoritative live-database evidence for this head is the required `verify`
context, which runs `ci:assert-staging` + `ci:db-smoke` inside the `staging-ci`
environment against the staging Supabase project and emits a
`ci-db-proof-receipt/v2` artifact that
`scripts/ci/verify-db-proof-receipt.ts` re-verifies in the same run (hostile
re-parse of TAP counts, run identity, and content hashes; absent artifact fails
closed). A green required `verify` check on this head is that receipt's
verdict.

### Rebase note

The branch was rebased onto `origin/main` with
`pnpm ops:merge-wrapper main-sync`. The only conflict was the `package.json`
`test:ops` script, resolved as the union of main's entries and this lane's two
new suites; no main entry was dropped. All eleven commits were replayed and the
focused, deploy-regression, R-level, and static gates above were re-measured on
the rebased head.

### R-level compliance

Command:

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Result:

```text
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Evidence

EVIDENCE:

- Verified implementation SHA:
  `f74021c9ba714cf407eaffd1070de9a286cea1c1`
- Structured evidence:
  `docs/06_status/proof/UTV2-1604/evidence.json`
- Model routing:
  `docs/06_status/proof/UTV2-1604/model-routing.json`

## Outstanding production gates

- Griff creates or confirms the repository secret as exactly
  `SYNDICATE_MACHINE_ENABLED=false`.
- A governed parked deployment completes.
- Evidence binds the deployed SHA and confirms expected service health.
- Runtime observation confirms requested and container values agree and no
  unexpected producer continues generating stale picks.
- An independent exact-head review passes.
- Griff supplies the T1 PM approval and merge authorization.
