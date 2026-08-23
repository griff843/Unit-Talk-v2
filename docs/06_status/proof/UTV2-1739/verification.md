# PROOF: UTV2-1739

MERGE_SHA: 2d80ffcadd9c172c5fa09334de9210ca7baeec5c

Verified source SHA: `2d80ffcadd9c172c5fa09334de9210ca7baeec5c`

This lane supersedes UTV2-1735. Its implementation is ported unchanged from PR
#1439 head `039a5bf5`, which remains open and preserved. **No proof text,
evidence or diff summary is carried forward from that lane.** Every figure below
was produced by a command run against this lane at this head.

The supersession reason is a contract one: the prior lane ran as `lane_type:
governance` with `proof_profile: static` while the issue is `kind:runtime`.
That classification waived the runtime proof requirement. This bundle is
`app-runtime` and satisfies it.

## ASSERTIONS:

- [x] Every column the implementation reads is asserted present against the live
  production schema, and `provider_offers.updated_at` — the original defect — is
  asserted ABSENT. This is the check the static profile waived.
- [x] Member-facing delivery is unauthorized by default, enforced in two layers,
  with activation requiring an explicit flag the workflow pins to `false`.
- [x] Persisted-but-undelivered detections are retried on `created_at` without
  resending delivered ones.
- [x] Production thresholds clamp to a 60-minute floor matching the measured
  scheduler cadence, and the floor honours larger operator values.
- [x] Delivery stays canary-only; system picks, SGO and ingestion stay disabled.
- [ ] Writable staging proof (`pnpm test:db`) green on the exact final head —
  **pending CI**, not claimed here.
- [ ] One durable independent review bound to the exact final head — **pending**.

## EVIDENCE:

```text
verify:static: PASS (exit 0)
focused runtime: PASS (20 tests, 0 failed)
runtime proof: READ-ONLY production queries PASS
writable staging proof: PENDING_CI (xskgrzbteyqdufktjrjx)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ingestor-alert-check.test.ts'` | PASS | 20 tests passed, 0 failed. |
| `pnpm verify:static` | PASS | Exit 0. |
| Live schema assertion | PASS | 7 of 8 read columns present; `provider_offers.updated_at` ABSENT as expected. |
| `pnpm test:db` (writable, staging) | PENDING_CI | Runs only in the governed `staging-ci` environment. Not claimed here. |

### Runtime proof — read-only, against production

The defect this lane exists to prevent was a monitor querying a column that does
not exist: it threw, and a monitor that throws is indistinguishable from one that
finds nothing. A static proof profile cannot catch that. Asserted directly:

```text
provider_offers.updated_at              ABSENT   <- the original defect
alert_detections.created_at             present
alert_detections.current_snapshot_at    present
alert_detections.notified               present
game_results.created_at                 present
provider_cycle_status.updated_at        present
system_runs.run_type                    present
system_runs.started_at                  present
```

Observed state, confirming the outage is real and current:

```text
alert_detections total                    176
alert_detections undelivered              176
alert_detections max created_at           2026-04-28 14:44:23+00
system_runs last alert.detection          2026-04-28 17:26:12+00
system_runs last alert.notification       2026-04-28 14:44:24+00
provider_cycle_status max updated_at      2026-06-30 12:54:53+00
game_results max created_at               2026-06-30 07:27:28+00
```

All 176 undelivered rows predate the retry window by roughly 117 days, so the
first live pass will not deliver a backlog.

No production mutation was performed. No query or row count is fabricated.

### Safety posture

`ALERT_MEMBER_CHANNELS_ENABLED` is pinned to `'false'`; `SYSTEM_PICKS_ENABLED`
is `'false'`; the workflow contains zero SGO or ingestion triggers. The only
production access in this lane was read-only SQL.

### Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  60 +-
scripts/ingestor-alert-check.test.ts           | 575 +++++++++++++++++-
scripts/ingestor-alert-check.ts                | 807 ++++++++++++++++++++-----
3 files changed, 1279 insertions(+), 163 deletions(-)
```

### Pending external evidence

- Writable `pnpm test:db` in `staging-ci` on the exact final head.
- One durable independent review bound to that head. One correction cycle maximum.
