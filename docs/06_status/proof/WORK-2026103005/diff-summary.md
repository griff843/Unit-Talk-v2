# WORK-2026103005 — private audience member-read boundary

MERGE_SHA: pending merge

Source candidate: `916228ed77abdfc05f49549148f2e22818786f78`.

Adds the pure contracts audience declaration/predicate, refuses malformed capper routing audiences, pins the resolved audience onto the release outbox destination, and excludes private/unknown/disagreeing pins from the in-scope member projections. Shared API outbox reads run in batches of at most eight. Member performance retains its existing complete population, delivery receipt, attribution and stable-snapshot checks. Existing Track Only and recap stop guards are preserved.

Tests exercise the real handlers for member picks, both results endpoints, service performance and bot stats/leaderboard, aggregate periods, and private per-pick recap destination. Exclusion does not delete the canonical pick records.

## Central split and pending verification

- Production Claude resolved the persisted pick-pin requirement at #1811 comment 6530796692: WORK-2026103021 Part B writes the pin at submission insert time, before persistence. It is removed from this lane's remaining acceptance. This lane pins the outbox audience and consumes the future pick pin without fabricating a metadata update or promotion decision.
- The three public preview/score readers remain outside the immutable lane scope; Production Claude assigned their isolation to WORK-2026103021 after this lane merges. No exhaustive anonymous-read isolation or production-canary readiness is claimed.
- Exact-head verification, staging receipt and T1 PM approval remain required.

Known bounded cost: public list endpoints can perform up to 200 indexed outbox point reads, in batches of eight. Claude accepted this cost for the current scope; a bulk repository reader requires a separate packages/db change. Corrupt cross-pick outbox evidence fails the entire read rather than silently widening visibility.

No production data, delivery controls, Discord audience/channel configuration, live delivery or deployment was changed.
