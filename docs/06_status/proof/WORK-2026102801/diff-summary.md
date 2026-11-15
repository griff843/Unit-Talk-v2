# WORK-2026102801 diff summary

- Added a governed `trackOnlyAwaitingSettlement` snapshot list and authoritative count.
- Predicate: unsettled, `metadata->>distributionMode = track-only`, and `status != voided`; rows are oldest-first and capped at 50.
- Added capper, event, sport, market, selection, line, odds, units, and submitted-time fields.
- Added the Settlement page stat card, table, canonical pick links, and explicit empty state.
- Added focused `node:test` coverage for inclusion, exclusions, ordering, count, and query predicate.
- No settlement, write, API, schema, migration, delivery, worker, authentication, or attribution changes.

## SHA Binding

Merge SHA: f4354929bd700d105f8103eb61038c174c0958f1
PR: https://github.com/griff843/Unit-Talk-v2/pull/1796
