# PROOF: UTV2-1604

MERGE_SHA: pending

## Summary

UTV2-1604 now has one fail-closed scheduler registration policy for all
fourteen API production schedulers. `SYNDICATE_MACHINE_ENABLED=false`
selects parked mode and prevents all six syndicate producer stages from
running at startup or registering an interval. `true` preserves active
registration. Missing, empty, case-variant, whitespace-padded, and other
values fail before runtime dependencies or the HTTP server are created.

This proof covers the bounded scheduler-policy lane only. It does not claim
the repository secret was created, a parked release was deployed, production
health passed, or the live blind-pick incident was contained.

ASSERTIONS:

- [x] Every API production scheduler is explicitly classified.
- [x] Every scheduled work function and interval is owned by the canonical policy.
- [x] Parked mode suppresses board scan, candidate scoring, ranked selection,
  board construction, board pick writer, and candidate pick scanner.
- [x] Active mode registers every production scheduler.
- [x] The board-writer-specific flag cannot bypass canonical parked mode.
- [x] Invalid or undeclared syndicate-machine values fail closed.
- [x] Runtime receipts report `active` or `parked` and the resolved decisions.
- [x] Removing any of the three newly required upstream producer gates fails
  static verification.
- [x] Adding a new unclassified interval fails static verification.
- [x] Full repo verification and live DB/T1 proof gates pass.

## Verification

### Focused scheduler contract

Command:

```text
npx tsx --test apps/api/src/scheduler-policy.test.ts scripts/ci/scheduler-classification.test.ts
```

Result:

```text
# tests 10
# pass 10
# fail 0
# skipped 0
```

The negative cases mutate the candidate-scoring, ranked-selection, and
board-construction registrations independently. Each mutation is detected.
A fourth mutation appends a new unclassified `setInterval`; it is also
detected.

### Runtime policy receipt

Command:

```text
npx tsx -e "<execute false and true through createSchedulerRegistrationPolicy>"
```

Parked result:

```json
{
  "requestedValue": "false",
  "mode": "parked",
  "executed": [
    "recap",
    "trial-expiry",
    "participant-enrichment",
    "system-pick-scanner",
    "closing-line-recovery",
    "market-universe-materializer",
    "line-movement-detector",
    "model-health-scanner"
  ],
  "suppressed": [
    "board-scan",
    "candidate-scoring",
    "ranked-selection",
    "board-construction",
    "board-pick-writer",
    "candidate-pick-scanner"
  ]
}
```

Active result:

```json
{
  "requestedValue": "true",
  "mode": "active",
  "executed_count": 14,
  "suppressed": []
}
```

### Full repository gate

Command:

```text
pnpm verify
```

Result: PASS.

The command completed environment validation, lint, `pnpm type-check`,
build, `pnpm test`, smart-form verification, command checks, `pnpm test:db`,
and the full live T1 proof battery.

Live database smoke:

```text
# tests 7
# pass 7
# fail 0
# duration_ms 93706.72273
```

The broader live T1 battery completed with zero failures. One bounded
provider-history assertion skipped because the newest provider snapshot was
older than its 72-hour lookback; the test explicitly classifies that as
stale provider data rather than a code regression.

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

- Substantive implementation SHA:
  `2781c39f26d6bf29fab54f25c37a420d5ec94a61`
- Structured evidence: `docs/06_status/proof/UTV2-1604/evidence.json`
- Model routing: `docs/06_status/proof/UTV2-1604/model-routing.json`
- Supabase project used by the mandatory DB gate: `zfzdnfwdarxucxtaojxm`

## Outstanding production gates

- Create or confirm the repository secret as exactly
  `SYNDICATE_MACHINE_ENABLED=false`.
- Complete the governed parked deployment.
- Bind proof to the deployed/merge SHA.
- Verify the expected services are healthy in parked mode.
- Prove no unexpected producer continues creating stale picks.
- Obtain the required exact-head independent review and T1 PM approval.
