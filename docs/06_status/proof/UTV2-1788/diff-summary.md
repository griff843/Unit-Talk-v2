# UTV2-1788 — Command Center stabilization diff summary

## Summary

This app-only lane consolidates Command Center into one internal operator control plane with exactly six primary workflows: Overview, Review, Active Picks, Settlement, Exceptions, and System Health. `COMMAND_CENTER_ROUTES` is now the single route/navigation authority, `/settlement` uses the existing governed settlement action, and unavailable data renders as unavailable rather than as fabricated success or inferred zero.

Command Center remains **not production-deployed**. Deployment, production configuration, authentication hardening, and privileged-read redesign require separate authorized lanes.

## Before and after

| Concern | Before | After |
| --- | --- | --- |
| Primary navigation | 32 shell entries conflicting with a 12-route registry plus two hardcoded workspace indexes | Six entries derived from one 56-route registry |
| Route inventory | 55 page routes with no current complete authority | 55 baseline routes classified plus one new authoritative `/settlement` route |
| Settlement | Registry claimed `/settlement`, but no page existed | Real workbench using `SettlementForm` and the existing `actions/settle.ts` API path |
| Exceptions | `/exceptions` redirected to a separate Results Ops concept | Authoritative exception triage; `/fire-board` redirects to it |
| Settlement history | `/operations/results` was a competing primary concept | Consolidated under `/settlement`; old route redirects |
| Unavailable data | Several catch paths emitted invented counts, model economics, health, or zeroes | Primary routes render explicit degraded/unavailable states |
| Primary counts | Today's Picks used a capped all-time recent-picks window; its trend query was separately capped at 10,000 rows; queue totals could fall back to visible row counts | Today's Picks and its seven-day series use exact UTC-day counts, and primary queue totals require exact authoritative counts |
| Headers | `/events` and `/intelligence` rendered a second incompatible header | One application header |
| Container recipe | App-only context omitted workspace packages, copied nonexistent `public/`, Node 20 | Repo-root context, workspace packages present, no nonexistent copy, Node 22 |

## Route inventory and classification

Baseline count: **55** `page.tsx` routes. After count: **56**, consisting of the same 55 routes plus `/settlement`. Classification totals are 7 authoritative (six primary plus Pick Detail), 1 degraded, 35 deferred, 11 stubs, and 2 duplicates.

| Route | Baseline | Classification | Disposition |
| --- | --- | --- | --- |
| `/` | yes | authoritative | Primary Overview |
| `/review` | yes | authoritative | Primary governed review |
| `/picks` | yes | authoritative | Primary Active Picks |
| `/settlement` | no | authoritative | New primary workflow using existing governed settle capability |
| `/exceptions` | yes | authoritative | Primary exception triage, replacing Fire Board |
| `/api-health` | yes | authoritative | Primary System Health |
| `/picks/[id]` | yes | authoritative | Retained child of Active Picks |
| `/pipeline` | yes | degraded | Direct access only; unavailable truth is explicit |
| `/fire-board` | yes | duplicate | Redirects to `/exceptions` |
| `/operations/results` | yes | duplicate | Redirects to `/settlement` |
| `/agents` | yes | stub | Redirects to `/api-health` |
| `/burn-in` | yes | stub | Redirects to `/api-health` |
| `/decisions` | yes | stub | Redirects to `/review` |
| `/held` | yes | stub | Redirects to `/review` |
| `/interventions` | yes | stub | Redirects to `/exceptions` |
| `/ops` | yes | stub | Redirects to `/api-health` |
| `/picks-list` | yes | stub | Redirects to `/picks` |
| `/runtime-dashboard` | yes | stub | Redirects to `/api-health` |
| `/research` | yes | stub | Historical redirect into deferred research |
| `/research/hit-rate` | yes | stub | Historical redirect into deferred trend research |
| `/research/matchups` | yes | stub | Historical redirect into deferred team research |
| `/events` | yes | deferred | Direct access only; explicit degradation on unavailable data |
| `/model-health` | yes | deferred | Outside the six-workflow boundary |
| `/performance` | yes | deferred | Decision-support reporting removed from primary navigation |
| `/intelligence` | yes | deferred | Model economics removed from primary navigation |
| `/intelligence/attribution` | yes | deferred | Direct access only |
| `/intelligence/calibration` | yes | deferred | Direct access only |
| `/intelligence/roi` | yes | deferred | Non-primary shell |
| `/decision` | yes | deferred | Module index derived from the route registry |
| `/decision/board-queue` | yes | deferred | Direct access only |
| `/decision/board` | yes | deferred | Direct access only |
| `/decision/hedges` | yes | deferred | Deferred shell |
| `/decision/preview` | yes | deferred | No authoritative read API |
| `/decision/routing` | yes | deferred | No authoritative routing API |
| `/decision/scores` | yes | deferred | Direct access only |
| `/execution/discord-preview` | yes | deferred | Execution tooling removed from primary navigation |
| `/execution/pick-builder` | yes | deferred | New-pick tooling outside this phase |
| `/execution/results` | yes | deferred | Execution tooling removed from primary navigation |
| `/execution/scheduled` | yes | deferred | Scheduling removed from primary navigation |
| `/operations/approvals` | yes | deferred | Review is authoritative |
| `/operations/discord` | yes | deferred | Delivery control outside this phase |
| `/operations/governance` | yes | deferred | Direct access only |
| `/operations/outbox` | yes | deferred | Direct access only |
| `/intel/alerts` | yes | deferred | New intelligence tooling outside this phase |
| `/intel/arbitrage` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/boosts` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/ev-feed` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/injuries` | yes | deferred | Research expansion outside this phase |
| `/intel/line-movement` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/middles` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/sharp-books` | yes | deferred | Trading-desk expansion outside this phase |
| `/intel/teams` | yes | deferred | Direct privileged-read risk; not primary |
| `/research/lines` | yes | deferred | Research removed from primary navigation |
| `/research/players` | yes | deferred | Research removed from primary navigation |
| `/research/props` | yes | deferred | Research removed from primary navigation |
| `/research/trends` | yes | deferred | Research removed from primary navigation |

## Navigation authority proof

- `src/lib/command-center-nav.ts` defines every route and the six primary records.
- `CommandCenterShell` derives the sidebar, mobile drawer, command palette, breadcrumbs, and classification banner from that registry.
- `IntelligenceWorkspaceNav` and the `/decision` index derive their links from the same registry.
- Dead competing `NavLinks`, `ui/Sidebar`, and incompatible `ui/TopBar` implementations are removed.
- Registry/filesystem equality and the exact six-primary set are enforced by `src/lib/command-center-nav.test.ts`.

## Duplicate and dead-surface disposition

| Surface | Disposition |
| --- | --- |
| Fire Board vs Exceptions | Fire Board implementation moved to Exceptions; old route redirects |
| Results Ops vs Settlement | Results workbench moved to Settlement; old route redirects |
| Root vs `ui/` TopBar | Unused incompatible `ui/TopBar` removed; double headers removed |
| `NavLinks` vs shell navigation | Dead `NavLinks` removed |
| `ui/Sidebar` vs `WorkspaceSidebar` | Dead `ui/Sidebar` removed |
| `ui/DataTable` vs table implementations | Zero-consumer duplicate removed |
| Intelligence and Decision hardcoded indexes | Replaced with registry-derived links |
| Other zero-consumer components | Left untouched unless consolidation was proven safe; they make no navigation-authority claim |

## Scope

Implementation changes are confined to `apps/command-center/**`. The only non-app paths are the authorized UTV2-1788 lane/sync/proof artifacts. No Smart Form, API, worker, package, migration, workflow, production deployment, environment, secret, or production-data file is changed.
