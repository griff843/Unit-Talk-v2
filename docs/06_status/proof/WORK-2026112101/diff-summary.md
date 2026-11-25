# Diff summary: WORK-2026112101

## Evidence

| File | Change |
|---|---|
| packages/domain/src/discord-presentation.ts | New `pickTitleLine` helper used by `buildPickPresentation`. The line is appended only when the selection does not already state its number (compared numerically), never with `@`. Spread, handicap, run-line and puck-line markets keep their sign; totals and props show the bare number. |
| packages/domain/src/discord-presentation.test.ts | Three title tests: line already stated, line appended without `@`, no line. |
| .ops/work/WORK-2026112101.md | Repo-owned work order. |
| docs/06_status/proof/WORK-2026112101/** | This proof bundle. |

No change to delivery targets, kill switches, outbox, entitlement, Track Only gating, schema or artwork behaviour.

## SHA Binding

Verified source SHA: 61db9ff7bfc47722e3753c023e5a0814e2de107d
