# PROOF: UTV2-1735

MERGE_SHA: 060f4c5cea97614b0bb1cd1b2b3dd84ad0ff196b

Verified source SHA: `060f4c5cea97614b0bb1cd1b2b3dd84ad0ff196b`

Substantive implementation SHA: `af9c95d01a51847e44a5df351956eadf02c8a9f7`

Pre-merge this anchor identifies the complete committed lane source after PR binding; the substantive implementation commit is listed separately. Later commits are restricted to proof artifacts. Post-merge closeout rebinds the proof to the authoritative merge SHA.

## ASSERTIONS:

- [x] A scheduled live-mode detection and notification pass is configured on a five-minute cron (`*/5`) while autonomous system picks remain disabled. **Measured effective cadence is roughly 28 minutes** — GitHub Actions does not honour a five-minute schedule under load (observed gaps of 20/29/36/49/18/24/21 minutes across the last eight runs). Detection latency against a 53-day outage is unaffected, but the `offers` and `cycle` checks clamp to a five-minute threshold under `--production-cadence`, so a real ~28-minute cadence will produce routine false CRITICALs once ingestion resumes. That clamp is pre-existing on `main`, not introduced here, and is recorded as a follow-up rather than silently tuned inside this lane.
- [x] An independent `always()` monitor treats stale ingestion, alerting silence, failed notification runs, and unreachable monitoring state as critical.
- [x] The focused runtime proof induces and observes detection persistence, canary notification, and successful detection/notification run receipts.
- [x] Static repository verification passes; writable DB proof is truthfully deferred to governed staging CI.

## EVIDENCE:

```text
focused runtime: PASS (10 tests, 0 failed)
pnpm verify:static: PASS
proof binding: PASS at the rebound source plus proof-only successor commit
writable DB: BLOCKED_DEFERRED locally; staging CI required
```

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

**Member-facing fan-out — disclosed, not blocked.** `ALERT_MIN_TIER` is unset, so it defaults to `watch`, and `resolveChannels` fans an `alert-worthy` signal to `discord:canary` **and `discord:trader-insights`**, which is a live VIP+ member-facing channel. No delivery can occur while ingestion is dead, but this path becomes live the moment ingestion resumes. The targets are sanctioned rather than blocked, so this is a disclosure and a merge-timing consideration, not a safety violation. An earlier revision of this section named only canary and omitted the member-facing target; that omission is corrected here. Setting `ALERT_MIN_TIER` to a higher threshold would confine delivery to canary if the PM prefers that until unpark.

### Pending external evidence

- Governed `staging-ci` execution of `pnpm test:db` with `CI_SUPABASE_*` credentials.
- Exact-head required checks and independent T1/PM review.
- Post-merge SHA rebind and lane finalization.
