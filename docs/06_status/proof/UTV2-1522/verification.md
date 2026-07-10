# UTV2-1522 — Command Center v2: verification

## Verification

All commands run in the lane worktree
(`.out/worktrees/claude__utv2-1522-command-center-v2`, branch
`claude/utv2-1522-command-center-v2`).

### Unit tests (app)

```
pnpm --filter @unit-talk/command-center test
# tests 93
# pass 93
# fail 0
```

Includes the new `command-palette-model.test.ts` (9 tests) plus the ported
pure-lib suites (odds-math, pick-builder-model, fire-board-model,
alert-builder, approvals-model, discord-preview-model, server-api, data
clients). Test script widened to run every `src/lib` test file.

### Type-check / lint / full verify

```
pnpm --filter @unit-talk/command-center type-check   # clean
pnpm lint                                            # clean
pnpm verify                                          # PASS (exit 0) — see summary below
```

pnpm verify summary: env:check + lint + type-check + build (tsc -b) + full unit
test suite, all green on the branch head.

Note: standalone `next build` static export of this app fails on main today for
pre-existing reasons (auth-required prerender + prerender errors reproduced on
unmodified main); it is not part of `pnpm verify` (root build is `tsc -b`) and
is unchanged by this lane.

### Playwright QA sweep (dev server :4300, dark theme, 1600x1000, bearer auth)

`apps/command-center/scripts/qa-sweep.ts` asserts per route: HTTP 200, zero
console errors, zero uncaught page errors, no visible `undefined`/`NaN`/
`[object Object]` text, a rendered `h1`, non-blank body; full-page screenshot
captured to `docs/06_status/proof/UTV2-1522/screenshots/`.

Result: **28/28 routes passing** (plus keeper drill-in below).

| Route | Status | Console errors | Notes |
|---|---|---|---|
| / | 200 | 0 | ok |
| /fire-board | 200 | 0 | ok |
| /pipeline | 200 | 0 | ok |
| /research/lines | 200 | 0 | ok |
| /research/props | 200 | 0 | ok |
| /intel/ev-feed | 200 | 0 | ok |
| /intel/arbitrage | 200 | 0 | ok |
| /intel/middles | 200 | 0 | ok |
| /intel/boosts | 200 | 0 | ok |
| /intel/sharp-books | 200 | 0 | ok |
| /intel/line-movement | 200 | 0 | ok |
| /research/players | 200 | 0 | ok |
| /intel/teams | 200 | 0 | ok |
| /intel/injuries | 200 | 0 | ok |
| /research/trends | 200 | 0 | ok |
| /intel/alerts | 200 | 0 | ok |
| /execution/pick-builder | 200 | 0 | ok |
| /review | 200 | 0 | ok |
| /execution/discord-preview | 200 | 0 | ok |
| /execution/scheduled | 200 | 0 | ok |
| /execution/results | 200 | 0 | ok |
| /operations/outbox | 200 | 0 | ok |
| /operations/approvals | 200 | 0 | ok |
| /operations/discord | 200 | 0 | ok |
| /operations/results | 200 | 0 | ok |
| /operations/governance | 200 | 0 | ok |
| /api-health | 200 | 0 | ok |
| /picks | 200 | 0 | ok |

Keeper drill-in `/picks/[id]` (live posted pick): status 200, 0 console errors,
header rendered, screenshot `drill-pick-detail.png`.

### Live-data vs contract-pending classification

**Live data wired (direct Supabase reads / apps/api):** executive overview,
fire board, today's action, odds board, props explorer, EV feed, arbitrage,
middles, sharp book compare, line movement, player research, team research,
trend explorer, pick builder, review queue, discord preview, results tracking,
outbox/delivery, approvals, discord control, results ops, system health,
picks index + pick detail drill-in.

**Contract-pending (designed fail-closed empty states naming the missing
contract; no fabricated data):** injury monitor (no injuries source), boost
analyzer's boost feed (no boosts table), alert builder persistence (no alert
storage), scheduled dispatch (no `dispatch_after` column), governance/lane
board (lane manifests live in repo docs, not readable at app runtime).

### Defects found and fixed during the sweep

1. Phantom `picks_current_state.event_name`/`event_start_time` selects → 42703
   on five surfaces; event context now derived from `picks.metadata`.
2. Nested `<tr>` inside `TableHead` on two execution pages → hydration errors.
3. Transient Postgres 57014 statement timeouts → one retry then fail-closed in
   queue fetchers; `/api-health` degrades to an explicit banner instead of 500.
4. `count: 'exact'` → `count: 'estimated'` on 67k-row view list totals.
