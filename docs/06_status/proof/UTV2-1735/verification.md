# PROOF: UTV2-1735

Verified source SHA: `f98eb1e981070b4a21e669238d7a0449901d619f`

Substantive implementation SHA: `af9c95d01a51847e44a5df351956eadf02c8a9f7`

Pre-merge this anchor identifies the substantive implementation commit. Later commits are restricted to proof and lane-control artifacts. Post-merge closeout rebinds the proof to the authoritative merge SHA.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ingestor-alert-check.test.ts'` | PASS | 10 tests passed, 0 failed. |
| `pnpm type-check` | PASS | Exit 0. |
| `pnpm lint` | PASS | Exit 0. |
| `pnpm verify:static` | PASS | Environment, policy, lint, type-check, build, aggregate `pnpm test`, Smart Form, and command checks passed. |
| `pnpm verify` | BLOCKED/DEFERRED | The static stage passed; the writable DB stage refused the non-staging workstation target before DB tests ran. |
| `pnpm test:db` | BLOCKED/DEFERRED | Must run in the governed `staging-ci` environment against `xskgrzbteyqdufktjrjx`. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | 10 changed files; no R-level rules matched. |

### Focused runtime proof

The focused `node:test` suite executes the actual alert-runtime detection and notification functions with in-memory repositories and a stubbed network boundary. It induces an NBA spread move from `4.5` to `6.5` and observes:

- one persisted alert detection;
- one live-mode notification to `discord:canary`;
- the detection marked notified with its channel persisted;
- successful `alert.detection` and `alert.notification` run receipts.

The suite separately induces stale ingestion, alerting silence, a notification run containing failed deliveries, and a monitor failure. Each becomes a CRITICAL finding and reaches the operations alert sink; the monitor never converts missing evidence into health.

Focused command trailer:

```text
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Static gate

`pnpm verify:static` passed. This includes the repository-wide `pnpm test` aggregate, where the UTV2-1735 focused cases also passed.

### Writable DB proof

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The local command observed the configured loopback host and refused before executing DB tests:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
```

No production or non-staging database mutation was attempted. No DB query or row-count result is fabricated.

### Full `pnpm verify` tail

```text
> @unit-talk/v2@0.1.0 test:live-db
> pnpm test:db && pnpm test:t1-proof:live

> @unit-talk/v2@0.1.0 test:db
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts

> @unit-talk/v2@0.1.0 ci:assert-staging
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
```

### Safety posture

The workflow explicitly keeps `SYSTEM_PICKS_ENABLED=false`. It restores real Discord delivery with `ALERT_DRY_RUN=false` without enabling autonomous system-pick submission. The workflow does not add or activate any blocked Discord target.

### Pending external evidence

- Governed `staging-ci` execution of `pnpm test:db` with `CI_SUPABASE_*` credentials.
- Exact-head required checks and independent T1/PM review.
- Post-merge SHA rebind and lane finalization.
