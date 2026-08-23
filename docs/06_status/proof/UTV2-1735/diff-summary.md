# UTV2-1735 Diff Summary

Generated at: 2026-08-23T14:02:04Z
Issue: UTV2-1735
Tier: T1
Lane type: governance
Branch: codex/utv2-1735-restore-alerting
Substantive SHA: af9c95d01a51847e44a5df351956eadf02c8a9f7

## Implementation

| File | Change |
|---|---|
| `.github/workflows/ingestor-staleness-alert.yml` | Runs alert detection and live notification every five minutes, then runs an independent `always()` monitor for both ingestion and alert-system freshness. |
| `scripts/ingestor-alert-check.ts` | Executes the scheduled alert pass, records detection/notification run truth, reads canonical ingestion timestamps, fails closed on missing or invalid evidence, and pages through the operations sink with a canary fallback. |
| `scripts/ingestor-alert-check.test.ts` | Adds executable runtime and fault-injection coverage for line movement, persistence, canary notification, alerting silence, stale ingestion, failed delivery, unknown monitor state, and workflow posture. |

## Proof and control plane

| File | Change |
|---|---|
| `.ops/sync/UTV2-1735.yml` | Registers the evidence artifacts. |
| `docs/06_status/proof/UTV2-1735/evidence.json` | Schema-v2 static evidence with runtime observations and truthful staging-DB deferral. |
| `docs/06_status/proof/UTV2-1735/model-routing.json` | Captures the manifest-selected Codex execution profile. |
| `docs/06_status/proof/UTV2-1735/verification.md` | Records commands, results, runtime proof, and the writable DB stop condition. |

## Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  52 ++-
scripts/ingestor-alert-check.test.ts           | 203 +++++++++
scripts/ingestor-alert-check.ts                | 595 ++++++++++++++++++-------
3 files changed, 696 insertions(+), 154 deletions(-)
```

## Scope notes

- No migration, contract, domain, database-authority, API routing, or worker file changed.
- No blocked Discord target was added or activated.
- `scripts/ops/burn-in-snapshot.ts` already reads `provider_offers.snapshot_at` on the branch base, so no out-of-scope correction was needed there.
- Writable DB proof remains reserved for the governed staging-CI target.
