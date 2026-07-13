# UTV2-1522 Diff Summary

Generated at: 2026-07-13T19:12:38.364Z
Issue: UTV2-1522
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1522-command-center-v2
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1190
Head SHA: 207bc8736df9bd57d836873ffc6cfc2c477f4941
Merge SHA: b0a9002be3dfae89ee1abb49ed17c15f2addd741
Diff base: b0a9002be3dfae89ee1abb49ed17c15f2addd741^1
Diff target: b0a9002be3dfae89ee1abb49ed17c15f2addd741

## Git Diff Stat
```
.ops/sync/UTV2-1522.yml                            |  10 +
 apps/command-center/package.json                   |   2 +-
 apps/command-center/scripts/dev-shot.ts            |  25 +
 apps/command-center/scripts/qa-sweep.ts            | 271 +++++++++
 apps/command-center/src/app/actions/board.ts       |   2 +-
 apps/command-center/src/app/actions/execution.ts   |  66 +++
 apps/command-center/src/app/agents/page.tsx        |  62 +-
 apps/command-center/src/app/api-health/page.tsx    |  32 +-
 apps/command-center/src/app/api/health/route.ts    |  49 +-
 apps/command-center/src/app/burn-in/page.tsx       | 639 +--------------------
 .../src/app/command-center-rebuild.test.tsx        |  12 +-
 .../src/app/decision/board-queue/page.tsx          |   4 +-
 .../command-center/src/app/decision/board/page.tsx |   4 +-
 .../src/app/decision/hedges/page.tsx               |   4 +-
 apps/command-center/src/app/decision/page.tsx      |   4 +-
 .../src/app/decision/preview/page.tsx              |  14 +-
 .../src/app/decision/routing/page.tsx              |  14 +-
 .../src/app/decision/scores/page.tsx               |   8 +-
 apps/command-center/src/app/decisions/page.tsx     | 125 +---
 apps/command-center/src/app/events/page.tsx        |   2 +
 apps/command-center/src/app/exceptions/page.tsx    | 420 +-------------
 .../src/app/execution/discord-preview/page.tsx     | 126 ++++
 .../src/app/execution/pick-builder/page.tsx        |  21 +
 .../src/app/execution/results/page.tsx             | 152 +++++
 .../src/app/execution/scheduled/page.tsx           | 137 +++++
 apps/command-center/src/app/fire-board/page.tsx    | 213 +++++++
 apps/command-center/src/app/globals.css            | 152 +++++
 apps/command-center/src/app/held/page.tsx          | 141 +----
 .../command-center/src/app/intel/alerts/layout.tsx |   5 +
 apps/command-center/src/app/intel/alerts/page.tsx  | 145 +++++
 .../src/app/intel/arbitrage/page.tsx               | 210 +++++++
 apps/command-center/src/app/intel/boosts/page.tsx  |  81 +++
 apps/command-center/src/app/intel/ev-feed/page.tsx | 252 ++++++++
 .../command-center/src/app/intel/injuries/page.tsx |  75 +++
 .../src/app/intel/line-movement/page.tsx           | 295 ++++++++++
 apps/command-center/src/app/intel/middles/page.tsx | 222 +++++++
 .../src/app/intel/sharp-books/page.tsx             | 241 ++++++++
 apps/command-center/src/app/intel/teams/page.tsx   | 228 ++++++++
 .../src/app/intelligence/attribution/page.tsx      |   7 +-
 .../src/app/intelligence/calibration/page.tsx      |   6 +-
 apps/command-center/src/app/intelligence/page.tsx  |   2 +
 .../src/app/intelligence/roi/page.tsx              |   6 +-
 apps/command-center/src/app/interventions/page.tsx |  91 +--
 apps/command-center/src/app/model-health/page.tsx  |  11 +-
 .../src/app/operations/approvals/page.tsx          | 362 ++++++++++++
 .../src/app/operations/discord/page.tsx            | 158 +++++
 .../src/app/operations/governance/page.tsx         |  61 ++
 .../src/app/operations/outbox/page.tsx             | 216 +++++++
 .../src/app/operations/results/page.tsx            | 191 ++++++
 apps/command-center/src/app/ops/page.tsx           |  63 +-
 apps/command-center/src/app/page.tsx               |  17 +-
 apps/command-center/src/app/performance/page.tsx   |  21 +-
 apps/command-center/src/app/picks-list/page.tsx    | 187 +-----
 apps/command-center/src/app/picks/[id]/page.tsx    |  85 +--
 apps/command-center/src/app/picks/page.tsx         |   2 +
 apps/command-center/src/app/pipeline/page.tsx      | 155 +++--
 .../src/app/research/hit-rate/page.tsx             | 184 +-----
 .../command-center/src/app/research/lines/page.tsx | 108 +++-
 .../src/app/research/matchups/page.tsx             | 210 +------
 apps/command-center/src/app/research/page.tsx      | 105 +---
 .../src/app/research/players/page.tsx              |   9 +-
 .../command-center/src/app/research/props/page.tsx |  87 ++-
 .../src/app/research/trends/page.tsx               |   4 +-
 apps/command-center/src/app/review/page.tsx        |   8 +-
 .../src/app/runtime-dashboard/page.tsx             | 232 +-------
 .../src/components/CommandCenterShell.tsx          | 221 +++++--
 .../src/components/CommandPalette.tsx              | 124 ++++
 .../src/components/DiscordEmbedPreview.tsx         |  82 +++
 .../src/components/EventsPageClient.tsx            |   2 +-
 .../src/components/InterventionAction.tsx          |   2 +-
 .../src/components/LineMovementChart.tsx           | 185 ++++++
 .../src/components/OverviewDashboardClient.tsx     | 139 ++---
 .../src/components/PickBuilderForm.tsx             | 233 ++++++++
 apps/command-center/src/components/PickFilters.tsx |   6 +-
 .../src/components/PickIdentityPanel.tsx           |   2 +-
 .../src/components/PicksExplorerClient.tsx         | 138 ++++-
 .../src/components/PicksWorkflowClient.tsx         |   6 +-
 .../command-center/src/components/QueueFilters.tsx |   2 +-
 .../src/components/ReviewQueueClient.tsx           | 253 ++++----
 .../src/components/SettlementForm.tsx              |  28 +-
 apps/command-center/src/components/TopBar.tsx      |  18 +-
 .../src/components/WorkspaceSidebar.tsx            |  32 +-
 .../src/components/ui/AlertBanner.tsx              |  35 ++
 .../src/components/ui/DegradedState.tsx            |  76 +++
 .../src/components/ui/InternalLabelBadge.tsx       |  72 +++
 .../src/components/ui/MicroSparkline.tsx           |  89 +++
 apps/command-center/src/components/ui/Num.tsx      |  49 ++
 .../src/components/ui/PipelineFlow.tsx             |  44 +-
 .../src/components/ui/SeverityBadge.tsx            |  20 +
 .../command-center/src/components/ui/Sparkline.tsx |  13 +-
 apps/command-center/src/components/ui/StatCard.tsx |  17 +-
 apps/command-center/src/components/ui/Table.tsx    |  23 +-
 .../command-center/src/components/ui/TierBadge.tsx |  41 ++
 apps/command-center/src/components/ui/index.ts     |  12 +
 apps/command-center/src/lib/alert-builder.test.ts  |  91 +++
 apps/command-center/src/lib/alert-builder.ts       | 105 ++++
 .../command-center/src/lib/alert-log-model.test.ts |  54 ++
 apps/command-center/src/lib/alert-log-model.ts     |  67 +++
 .../command-center/src/lib/approvals-model.test.ts |  80 +++
 apps/command-center/src/lib/approvals-model.ts     |  92 +++
 apps/command-center/src/lib/boost-contract.ts      |  39 ++
 apps/command-center/src/lib/command-center-data.ts |  26 +-
 .../src/lib/command-palette-model.test.ts          |  64 +++
 .../src/lib/command-palette-model.ts               |  74 +++
 apps/command-center/src/lib/data/analytics.ts      |  46 +-
 apps/command-center/src/lib/data/api-health.ts     |   3 +-
 apps/command-center/src/lib/data/approvals-ops.ts  |  46 ++
 apps/command-center/src/lib/data/dashboard.ts      |  44 ++
 apps/command-center/src/lib/data/discord-ops.ts    |  99 ++++
 apps/command-center/src/lib/data/execution.ts      | 377 ++++++++++++
 apps/command-center/src/lib/data/index.ts          |   2 +-
 apps/command-center/src/lib/data/odds-intel.ts     | 350 +++++++++++
 apps/command-center/src/lib/data/outbox.ts         | 133 +++++
 apps/command-center/src/lib/data/queues.ts         |  85 ++-
 apps/command-center/src/lib/data/results-ops.ts    | 148 +++++
 apps/command-center/src/lib/describe-error.test.ts |  31 +
 apps/command-center/src/lib/describe-error.ts      |  27 +
 .../command-center/src/lib/discord-ops-contract.ts |  39 ++
 .../src/lib/discord-preview-model.test.ts          |  56 ++
 .../src/lib/discord-preview-model.ts               | 114 ++++
 .../src/lib/fire-board-model.test.ts               | 138 +++++
 apps/command-center/src/lib/fire-board-model.ts    | 276 +++++++++
 apps/command-center/src/lib/governance-contract.ts |  62 ++
 apps/command-center/src/lib/injury-contract.ts     |  40 ++
 apps/command-center/src/lib/intel-format.ts        |  32 ++
 .../src/lib/microchart-model.test.ts               |  79 +++
 apps/command-center/src/lib/microchart-model.ts    | 102 ++++
 apps/command-center/src/lib/odds-math.test.ts      | 104 ++++
 apps/command-center/src/lib/odds-math.ts           | 131 +++++
 .../src/lib/pick-builder-model.test.ts             |  92 +++
 apps/command-center/src/lib/pick-builder-model.ts  | 163 ++++++
 apps/command-center/src/lib/pipeline-stages.ts     |  37 ++
 .../src/lib/scheduled-dispatch-contract.ts         |  34 ++
 apps/command-center/tailwind.config.ts             |  53 ++
 docs/06_status/lanes/UTV2-1522.json                |  37 ++
 docs/06_status/proof/UTV2-1522/.gitkeep            |   0
 docs/06_status/proof/UTV2-1522/diff-summary.md     |  70 +++
 .../proof/UTV2-1522/screenshots/api-health.png     | Bin 0 -> 280465 bytes
 .../UTV2-1522/screenshots/decision-board-queue.png | Bin 0 -> 528706 bytes
 .../proof/UTV2-1522/screenshots/decision-board.png | Bin 0 -> 331967 bytes
 .../UTV2-1522/screenshots/decision-hedges.png      | Bin 0 -> 345172 bytes
 .../UTV2-1522/screenshots/decision-preview.png     | Bin 0 -> 321552 bytes
 .../UTV2-1522/screenshots/decision-routing.png     | Bin 0 -> 322963 bytes
 .../UTV2-1522/screenshots/decision-scores.png      | Bin 0 -> 5476553 bytes
 .../proof/UTV2-1522/screenshots/decision.png       | Bin 0 -> 389947 bytes
 .../screenshots/desk-executive-overview.png        | Bin 0 -> 613343 bytes
 .../UTV2-1522/screenshots/desk-fire-board.png      | Bin 0 -> 357135 bytes
 .../UTV2-1522/screenshots/desk-todays-action.png   | Bin 0 -> 417466 bytes
 .../UTV2-1522/screenshots/drill-pick-detail.png    | Bin 0 -> 690692 bytes
 .../UTV2-1522/screenshots/drill-picks-index.png    | Bin 0 -> 2743042 bytes
 .../proof/UTV2-1522/screenshots/events.png         | Bin 0 -> 486371 bytes
 .../UTV2-1522/screenshots/exec-discord-preview.png | Bin 0 -> 685350 bytes
 .../UTV2-1522/screenshots/exec-pick-builder.png    | Bin 0 -> 326924 bytes
 .../screenshots/exec-results-tracking.png          | Bin 0 -> 1883416 bytes
 .../UTV2-1522/screenshots/exec-review-queue.png    | Bin 0 -> 2028817 bytes
 .../screenshots/exec-scheduled-dispatch.png        | Bin 0 -> 274410 bytes
 .../screenshots/execution-discord-preview.png      | Bin 0 -> 704201 bytes
 .../screenshots/execution-pick-builder.png         | Bin 0 -> 328932 bytes
 .../UTV2-1522/screenshots/execution-results.png    | Bin 0 -> 1891416 bytes
 .../UTV2-1522/screenshots/execution-scheduled.png  | Bin 0 -> 300642 bytes
 .../proof/UTV2-1522/screenshots/fire-board.png     | Bin 0 -> 376922 bytes
 .../UTV2-1522/screenshots/intel-alert-builder.png  | Bin 0 -> 299081 bytes
 .../proof/UTV2-1522/screenshots/intel-alerts.png   | Bin 0 -> 326243 bytes
 .../UTV2-1522/screenshots/intel-arbitrage.png      | Bin 0 -> 352113 bytes
 .../proof/UTV2-1522/screenshots/intel-boosts.png   | Bin 0 -> 327748 bytes
 .../proof/UTV2-1522/screenshots/intel-ev-feed.png  | Bin 0 -> 344190 bytes
 .../proof/UTV2-1522/screenshots/intel-injuries.png | Bin 0 -> 300518 bytes
 .../UTV2-1522/screenshots/intel-injury-monitor.png | Bin 0 -> 271128 bytes
 .../UTV2-1522/screenshots/intel-line-movement.png  | Bin 0 -> 323528 bytes
 .../proof/UTV2-1522/screenshots/intel-middles.png  | Bin 0 -> 329757 bytes
 .../UTV2-1522/screenshots/intel-odds-board.png     | Bin 0 -> 291188 bytes
 .../screenshots/intel-player-research.png          | Bin 0 -> 646115 bytes
 .../UTV2-1522/screenshots/intel-props-explorer.png | Bin 0 -> 299994 bytes
 .../UTV2-1522/screenshots/intel-sharp-books.png    | Bin 0 -> 359853 bytes
 .../UTV2-1522/screenshots/intel-team-research.png  | Bin 0 -> 296760 bytes
 .../proof/UTV2-1522/screenshots/intel-teams.png    | Bin 0 -> 328253 bytes
 .../UTV2-1522/screenshots/intel-trend-explorer.png | Bin 0 -> 270805 bytes
 .../screenshots/intelligence-attribution.png       | Bin 0 -> 367151 bytes
 .../screenshots/intelligence-calibration.png       | Bin 0 -> 443744 bytes
 .../UTV2-1522/screenshots/intelligence-roi.png     | Bin 0 -> 345432 bytes
 .../proof/UTV2-1522/screenshots/intelligence.png   | Bin 0 -> 432204 bytes
 .../proof/UTV2-1522/screenshots/model-health.png   | Bin 0 -> 334161 bytes
 .../UTV2-1522/screenshots/operations-approvals.png | Bin 0 -> 3060299 bytes
 .../UTV2-1522/screenshots/operations-discord.png   | Bin 0 -> 1121910 bytes
 .../screenshots/operations-governance.png          | Bin 0 -> 319647 bytes
 .../UTV2-1522/screenshots/operations-outbox.png    | Bin 0 -> 1885153 bytes
 .../UTV2-1522/screenshots/operations-results.png   | Bin 0 -> 2129352 bytes
 .../proof/UTV2-1522/screenshots/ops-approvals.png  | Bin 0 -> 3140013 bytes
 .../UTV2-1522/screenshots/ops-discord-control.png  | Bin 0 -> 1110362 bytes
 .../proof/UTV2-1522/screenshots/ops-outbox.png     | Bin 0 -> 1896627 bytes
 .../proof/UTV2-1522/screenshots/ops-results.png    | Bin 0 -> 2130272 bytes
 .../proof/UTV2-1522/screenshots/performance.png    | Bin 0 -> 488986 bytes
 .../proof/UTV2-1522/screenshots/picks.png          | Bin 0 -> 2680378 bytes
 .../proof/UTV2-1522/screenshots/pipeline.png       | Bin 0 -> 36816 bytes
 .../proof/UTV2-1522/screenshots/research-lines.png | Bin 0 -> 324773 bytes
 .../UTV2-1522/screenshots/research-players.png     | Bin 0 -> 656269 bytes
 .../proof/UTV2-1522/screenshots/research-props.png | Bin 0 -> 334828 bytes
 .../UTV2-1522/screenshots/research-trends.png      | Bin 0 -> 306593 bytes
 .../proof/UTV2-1522/screenshots/review.png         | Bin 0 -> 625303 bytes
 .../06_status/proof/UTV2-1522/screenshots/root.png | Bin 0 -> 418065 bytes
 .../UTV2-1522/screenshots/system-governance.png    | Bin 0 -> 289791 bytes
 .../proof/UTV2-1522/screenshots/system-health.png  | Bin 0 -> 251993 bytes
 docs/06_status/proof/UTV2-1522/verification.md     | 104 ++++
 203 files changed, 9895 insertions(+), 2968 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1522.yml
M	apps/command-center/package.json
A	apps/command-center/scripts/dev-shot.ts
A	apps/command-center/scripts/qa-sweep.ts
M	apps/command-center/src/app/actions/board.ts
A	apps/command-center/src/app/actions/execution.ts
M	apps/command-center/src/app/agents/page.tsx
M	apps/command-center/src/app/api-health/page.tsx
M	apps/command-center/src/app/api/health/route.ts
M	apps/command-center/src/app/burn-in/page.tsx
M	apps/command-center/src/app/command-center-rebuild.test.tsx
M	apps/command-center/src/app/decision/board-queue/page.tsx
M	apps/command-center/src/app/decision/board/page.tsx
M	apps/command-center/src/app/decision/hedges/page.tsx
M	apps/command-center/src/app/decision/page.tsx
M	apps/command-center/src/app/decision/preview/page.tsx
M	apps/command-center/src/app/decision/routing/page.tsx
M	apps/command-center/src/app/decision/scores/page.tsx
M	apps/command-center/src/app/decisions/page.tsx
M	apps/command-center/src/app/events/page.tsx
M	apps/command-center/src/app/exceptions/page.tsx
A	apps/command-center/src/app/execution/discord-preview/page.tsx
A	apps/command-center/src/app/execution/pick-builder/page.tsx
A	apps/command-center/src/app/execution/results/page.tsx
A	apps/command-center/src/app/execution/scheduled/page.tsx
A	apps/command-center/src/app/fire-board/page.tsx
M	apps/command-center/src/app/globals.css
M	apps/command-center/src/app/held/page.tsx
A	apps/command-center/src/app/intel/alerts/layout.tsx
A	apps/command-center/src/app/intel/alerts/page.tsx
A	apps/command-center/src/app/intel/arbitrage/page.tsx
A	apps/command-center/src/app/intel/boosts/page.tsx
A	apps/command-center/src/app/intel/ev-feed/page.tsx
A	apps/command-center/src/app/intel/injuries/page.tsx
A	apps/command-center/src/app/intel/line-movement/page.tsx
A	apps/command-center/src/app/intel/middles/page.tsx
A	apps/command-center/src/app/intel/sharp-books/page.tsx
A	apps/command-center/src/app/intel/teams/page.tsx
M	apps/command-center/src/app/intelligence/attribution/page.tsx
M	apps/command-center/src/app/intelligence/calibration/page.tsx
M	apps/command-center/src/app/intelligence/page.tsx
M	apps/command-center/src/app/intelligence/roi/page.tsx
M	apps/command-center/src/app/interventions/page.tsx
M	apps/command-center/src/app/model-health/page.tsx
A	apps/command-center/src/app/operations/approvals/page.tsx
A	apps/command-center/src/app/operations/discord/page.tsx
A	apps/command-center/src/app/operations/governance/page.tsx
A	apps/command-center/src/app/operations/outbox/page.tsx
A	apps/command-center/src/app/operations/results/page.tsx
M	apps/command-center/src/app/ops/page.tsx
M	apps/command-center/src/app/page.tsx
M	apps/command-center/src/app/performance/page.tsx
M	apps/command-center/src/app/picks-list/page.tsx
M	apps/command-center/src/app/picks/[id]/page.tsx
M	apps/command-center/src/app/picks/page.tsx
M	apps/command-center/src/app/pipeline/page.tsx
M	apps/command-center/src/app/research/hit-rate/page.tsx
M	apps/command-center/src/app/research/lines/page.tsx
M	apps/command-center/src/app/research/matchups/page.tsx
M	apps/command-center/src/app/research/page.tsx
M	apps/command-center/src/app/research/players/page.tsx
M	apps/command-center/src/app/research/props/page.tsx
M	apps/command-center/src/app/research/trends/page.tsx
M	apps/command-center/src/app/review/page.tsx
M	apps/command-center/src/app/runtime-dashboard/page.tsx
M	apps/command-center/src/components/CommandCenterShell.tsx
A	apps/command-center/src/components/CommandPalette.tsx
A	apps/command-center/src/components/DiscordEmbedPreview.tsx
M	apps/command-center/src/components/EventsPageClient.tsx
M	apps/command-center/src/components/InterventionAction.tsx
A	apps/command-center/src/components/LineMovementChart.tsx
M	apps/command-center/src/components/OverviewDashboardClient.tsx
A	apps/command-center/src/components/PickBuilderForm.tsx
M	apps/command-center/src/components/PickFilters.tsx
M	apps/command-center/src/components/PickIdentityPanel.tsx
M	apps/command-center/src/components/PicksExplorerClient.tsx
M	apps/command-center/src/components/PicksWorkflowClient.tsx
M	apps/command-center/src/components/QueueFilters.tsx
M	apps/command-center/src/components/ReviewQueueClient.tsx
M	apps/command-center/src/components/SettlementForm.tsx
M	apps/command-center/src/components/TopBar.tsx
M	apps/command-center/src/components/WorkspaceSidebar.tsx
A	apps/command-center/src/components/ui/AlertBanner.tsx
A	apps/command-center/src/components/ui/DegradedState.tsx
A	apps/command-center/src/components/ui/InternalLabelBadge.tsx
A	apps/command-center/src/components/ui/MicroSparkline.tsx
A	apps/command-center/src/components/ui/Num.tsx
M	apps/command-center/src/components/ui/PipelineFlow.tsx
A	apps/command-center/src/components/ui/SeverityBadge.tsx
M	apps/command-center/src/components/ui/Sparkline.tsx
M	apps/command-center/src/components/ui/StatCard.tsx
M	apps/command-center/src/components/ui/Table.tsx
A	apps/command-center/src/components/ui/TierBadge.tsx
M	apps/command-center/src/components/ui/index.ts
A	apps/command-center/src/lib/alert-builder.test.ts
A	apps/command-center/src/lib/alert-builder.ts
A	apps/command-center/src/lib/alert-log-model.test.ts
A	apps/command-center/src/lib/alert-log-model.ts
A	apps/command-center/src/lib/approvals-model.test.ts
A	apps/command-center/src/lib/approvals-model.ts
A	apps/command-center/src/lib/boost-contract.ts
M	apps/command-center/src/lib/command-center-data.ts
A	apps/command-center/src/lib/command-palette-model.test.ts
A	apps/command-center/src/lib/command-palette-model.ts
M	apps/command-center/src/lib/data/analytics.ts
M	apps/command-center/src/lib/data/api-health.ts
A	apps/command-center/src/lib/data/approvals-ops.ts
M	apps/command-center/src/lib/data/dashboard.ts
A	apps/command-center/src/lib/data/discord-ops.ts
A	apps/command-center/src/lib/data/execution.ts
M	apps/command-center/src/lib/data/index.ts
A	apps/command-center/src/lib/data/odds-intel.ts
A	apps/command-center/src/lib/data/outbox.ts
M	apps/command-center/src/lib/data/queues.ts
A	apps/command-center/src/lib/data/results-ops.ts
A	apps/command-center/src/lib/describe-error.test.ts
A	apps/command-center/src/lib/describe-error.ts
A	apps/command-center/src/lib/discord-ops-contract.ts
A	apps/command-center/src/lib/discord-preview-model.test.ts
A	apps/command-center/src/lib/discord-preview-model.ts
A	apps/command-center/src/lib/fire-board-model.test.ts
A	apps/command-center/src/lib/fire-board-model.ts
A	apps/command-center/src/lib/governance-contract.ts
A	apps/command-center/src/lib/injury-contract.ts
A	apps/command-center/src/lib/intel-format.ts
A	apps/command-center/src/lib/microchart-model.test.ts
A	apps/command-center/src/lib/microchart-model.ts
A	apps/command-center/src/lib/odds-math.test.ts
A	apps/command-center/src/lib/odds-math.ts
A	apps/command-center/src/lib/pick-builder-model.test.ts
A	apps/command-center/src/lib/pick-builder-model.ts
A	apps/command-center/src/lib/pipeline-stages.ts
A	apps/command-center/src/lib/scheduled-dispatch-contract.ts
M	apps/command-center/tailwind.config.ts
A	docs/06_status/lanes/UTV2-1522.json
A	docs/06_status/proof/UTV2-1522/.gitkeep
A	docs/06_status/proof/UTV2-1522/diff-summary.md
A	docs/06_status/proof/UTV2-1522/screenshots/api-health.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-board-queue.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-board.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-hedges.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-preview.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-routing.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision-scores.png
A	docs/06_status/proof/UTV2-1522/screenshots/decision.png
A	docs/06_status/proof/UTV2-1522/screenshots/desk-executive-overview.png
A	docs/06_status/proof/UTV2-1522/screenshots/desk-fire-board.png
A	docs/06_status/proof/UTV2-1522/screenshots/desk-todays-action.png
A	docs/06_status/proof/UTV2-1522/screenshots/drill-pick-detail.png
A	docs/06_status/proof/UTV2-1522/screenshots/drill-picks-index.png
A	docs/06_status/proof/UTV2-1522/screenshots/events.png
A	docs/06_status/proof/UTV2-1522/screenshots/exec-discord-preview.png
A	docs/06_status/proof/UTV2-1522/screenshots/exec-pick-builder.png
A	docs/06_status/proof/UTV2-1522/screenshots/exec-results-tracking.png
A	docs/06_status/proof/UTV2-1522/screenshots/exec-review-queue.png
A	docs/06_status/proof/UTV2-1522/screenshots/exec-scheduled-dispatch.png
A	docs/06_status/proof/UTV2-1522/screenshots/execution-discord-preview.png
A	docs/06_status/proof/UTV2-1522/screenshots/execution-pick-builder.png
A	docs/06_status/proof/UTV2-1522/screenshots/execution-results.png
A	docs/06_status/proof/UTV2-1522/screenshots/execution-scheduled.png
A	docs/06_status/proof/UTV2-1522/screenshots/fire-board.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-alert-builder.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-alerts.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-arbitrage.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-boosts.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-ev-feed.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-injuries.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-injury-monitor.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-line-movement.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-middles.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-odds-board.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-player-research.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-props-explorer.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-sharp-books.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-team-research.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-teams.png
A	docs/06_status/proof/UTV2-1522/screenshots/intel-trend-explorer.png
A	docs/06_status/proof/UTV2-1522/screenshots/intelligence-attribution.png
A	docs/06_status/proof/UTV2-1522/screenshots/intelligence-calibration.png
A	docs/06_status/proof/UTV2-1522/screenshots/intelligence-roi.png
A	docs/06_status/proof/UTV2-1522/screenshots/intelligence.png
A	docs/06_status/proof/UTV2-1522/screenshots/model-health.png
A	docs/06_status/proof/UTV2-1522/screenshots/operations-approvals.png
A	docs/06_status/proof/UTV2-1522/screenshots/operations-discord.png
A	docs/06_status/proof/UTV2-1522/screenshots/operations-governance.png
A	docs/06_status/proof/UTV2-1522/screenshots/operations-outbox.png
A	docs/06_status/proof/UTV2-1522/screenshots/operations-results.png
A	docs/06_status/proof/UTV2-1522/screenshots/ops-approvals.png
A	docs/06_status/proof/UTV2-1522/screenshots/ops-discord-control.png
A	docs/06_status/proof/UTV2-1522/screenshots/ops-outbox.png
A	docs/06_status/proof/UTV2-1522/screenshots/ops-results.png
A	docs/06_status/proof/UTV2-1522/screenshots/performance.png
A	docs/06_status/proof/UTV2-1522/screenshots/picks.png
A	docs/06_status/proof/UTV2-1522/screenshots/pipeline.png
A	docs/06_status/proof/UTV2-1522/screenshots/research-lines.png
A	docs/06_status/proof/UTV2-1522/screenshots/research-players.png
A	docs/06_status/proof/UTV2-1522/screenshots/research-props.png
A	docs/06_status/proof/UTV2-1522/screenshots/research-trends.png
A	docs/06_status/proof/UTV2-1522/screenshots/review.png
A	docs/06_status/proof/UTV2-1522/screenshots/root.png
A	docs/06_status/proof/UTV2-1522/screenshots/system-governance.png
A	docs/06_status/proof/UTV2-1522/screenshots/system-health.png
A	docs/06_status/proof/UTV2-1522/verification.md
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 207bc8736df9bd57d836873ffc6cfc2c477f4941
Merge SHA: b0a9002be3dfae89ee1abb49ed17c15f2addd741
