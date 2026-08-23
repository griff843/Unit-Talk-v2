# UTV2-1735 Diff Summary

MERGE_SHA: 88d252b6655f0276e41cf3a47b35499d63b25d93

Generated at: 2026-08-23T14:02:04Z
Issue: UTV2-1735
Tier: T1
Lane type: governance
Branch: codex/utv2-1735-restore-alerting
Substantive SHA: 88d252b6655f0276e41cf3a47b35499d63b25d93

## Implementation

| File | Change |
|---|---|
| `.github/workflows/ingestor-staleness-alert.yml` | Schedules the alert detection and live notification pass, then runs an `always()` monitor for ingestion and alert-system freshness. The monitor is `needs: alerting-pass` in the same run, so it is independent of that job's outcome but not of the schedule; external scheduler-death detection is owned by UTV2-1738. |
| `scripts/ingestor-alert-check.ts` | Executes the scheduled alert pass, records detection/notification run truth, reads canonical ingestion timestamps, fails closed on missing or invalid evidence, and pages through the operations sink with a canary fallback. Adds `buildChannelGuardedFetch` (member-facing Discord channels refused unless `ALERT_MEMBER_CHANNELS_ENABLED=true`), `mergeUndeliveredDetections` (retries persisted-but-undelivered detections without resending delivered ones), and clamps production thresholds to a 60-minute observed-cadence floor instead of the nominal five. |
| `scripts/ingestor-alert-check.test.ts` | Adds executable runtime and fault-injection coverage for line movement, persistence, canary notification, alerting silence, stale ingestion, failed delivery, unknown monitor state, and workflow posture. Adds inversion coverage proving member channels are refused by default, permitted only under explicit activation, failed closed when the target map is unresolvable, that undelivered detections retry without duplication, and that a six-minute-old offer is not CRITICAL while a ninety-minute-old one is. |

## Proof and control plane

| File | Change |
|---|---|
| `.ops/sync/UTV2-1735.yml` | Registers the evidence artifacts. |
| `docs/06_status/proof/UTV2-1735/evidence.json` | Schema-v2 static evidence with runtime observations and truthful staging-DB deferral. |
| `docs/06_status/proof/UTV2-1735/model-routing.json` | Captures the manifest-selected Codex execution profile. |
| `docs/06_status/proof/UTV2-1735/verification.md` | Records commands, results, runtime proof, and the writable DB stop condition. |

## Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  60 +-
scripts/ingestor-alert-check.test.ts           | 575 +++++++++++++++++-
scripts/ingestor-alert-check.ts                | 807 ++++++++++++++++++++-----
3 files changed, 1279 insertions(+), 163 deletions(-)
```

## Scope notes

- No migration, contract, domain, database-authority, API routing, or worker file changed.
- No blocked Discord target was added or activated. Member-facing delivery is blocked by default in two layers: the member target is stripped from the resolvable target map, and the transport refuses it. The workflow sets `ALERT_MEMBER_CHANNELS_ENABLED: 'false'` explicitly; activating member delivery requires setting it to `'true'`, which this lane does not do.
- `scripts/ops/burn-in-snapshot.ts` already reads `provider_offers.snapshot_at` on the branch base, so no out-of-scope correction was needed there.
- Writable DB proof remains reserved for the governed staging-CI target.
