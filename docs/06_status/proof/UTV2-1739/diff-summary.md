# UTV2-1739 Diff Summary

MERGE_SHA: 2d80ffcadd9c172c5fa09334de9210ca7baeec5c

Issue: UTV2-1739
Tier: T1
Lane type: runtime
Proof profile: app-runtime
Branch: claude/utv2-1739-alerting-runtime

## Implementation — three ported surfaces only

| File | Change |
|---|---|
| `.github/workflows/ingestor-staleness-alert.yml` | Schedules the live-mode alerting pass and an `always()` monitor. Pins `ALERT_MEMBER_CHANNELS_ENABLED: 'false'`, `SYSTEM_PICKS_ENABLED: 'false'`, and the self-monitor threshold to 60. |
| `scripts/ingestor-alert-check.ts` | Alert detection, notification and self-monitoring. Reads canonical freshness sources; withholds member targets and refuses them at the transport; retries undelivered detections on `created_at`; clamps production thresholds to an observed-cadence floor. |
| `scripts/ingestor-alert-check.test.ts` | 20 focused cases including both member-guard layers, the retry, the threshold floor in both directions, and restoration of the mutated target map on every exit path. |

Nothing else was ported. No proof artifact from the superseded lane was carried forward.

## Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  60 +-
scripts/ingestor-alert-check.test.ts           | 575 +++++++++++++++++-
scripts/ingestor-alert-check.ts                | 807 ++++++++++++++++++++-----
3 files changed, 1279 insertions(+), 163 deletions(-)
```

## Scope notes

- No migration, contract, domain, database-authority, API routing or worker file changed.
- No blocked Discord target was added or activated.
- Production stays parked; the only production access was read-only SQL.
