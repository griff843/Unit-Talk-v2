# WORK-2026103005 — private audience member-read boundary

Source candidate: `916228ed77abdfc05f49549148f2e22818786f78`.

Adds the pure contracts audience declaration/predicate, refuses malformed capper routing audiences, pins the resolved audience onto the release outbox destination, and excludes private/unknown/disagreeing pins from the in-scope member projections. Shared API outbox reads run in batches of at most eight. Member performance retains its existing complete population, delivery receipt, attribution and stable-snapshot checks. Existing Track Only and recap stop guards are preserved.

Tests exercise the real handlers for member picks, both results endpoints, service performance and bot stats/leaderboard, aggregate periods, and private per-pick recap destination. Exclusion does not delete the canonical pick records.

## Incomplete requirements — draft, not ready for merge

- Persisting the resolved audience onto `picks.metadata.deliveryAuthorization` needs a supported metadata-only persistence path. Current PickRepository exposes no such operation; Database savePick inserts, and the enqueue RPC has no pick metadata patch. This source does not fake persistence by changing an in-memory object or emitting a fabricated promotion decision. Central request: #1810 comment 6530413825.
- The three public preview/score readers remain outside the immutable lane scope; Production Claude assigned their isolation to WORK-2026103021 after this lane merges. No exhaustive anonymous-read isolation or production-canary readiness is claimed.
- Exact-head verification, staging receipt and T1 PM approval remain required.

No production data, delivery controls, Discord audience/channel configuration, live delivery or deployment was changed.
