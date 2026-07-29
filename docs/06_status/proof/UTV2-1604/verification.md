# PROOF: UTV2-1604

MERGE_SHA: pending

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

## Verification

### Canonical parked-mode safety suites

Command:

```text
npx tsx --test scripts/ci/deploy-parked-mode.test.ts scripts/ci/scheduler-classification.test.ts apps/api/src/scheduler-policy.test.ts packages/config/src/env.test.ts
```

Result:

```text
# tests 30
# pass 30
# fail 0
# skipped 0
# duration_ms 1145.623161
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

Result:

```text
# tests 73
# pass 73
# fail 0
```

### Full repository gate

Commands:

```text
pnpm type-check
pnpm test
pnpm test:db
pnpm verify
```

Result: PASS.

`pnpm verify` completed environment checks, lint, `pnpm type-check`, build,
`pnpm test`, smart-form verification, command checks, `pnpm test:db`, and the
live T1 proof battery. The DB smoke suite passed 7/7 against Supabase project
`zfzdnfwdarxucxtaojxm`.

The ignored credential file was exposed to this worktree with
`scripts/link-worktree-env.ts` as a hardlink for the duration of the command;
it was not copied or modified.

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

- Verified implementation SHA:
  `d4dddc66c4b261972731a311ef73220d34328cbd`
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
