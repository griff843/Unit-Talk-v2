# UTV2-1522 — Command Center v2: diff summary

Premium internal trading-desk redesign of `apps/command-center`. All changes are
scoped to `apps/command-center/**` plus this proof directory and the lane
apparatus files.

## Architecture / visual system

- **Single token source.** `globals.css` now declares the full neutral scale as
  RGB triplets (`--cc-n-50…950` + elevated/hover/accent/status), dark-first with
  a `[data-theme='light']` flip. `tailwind.config.ts` remaps Tailwind's
  `gray`/`slate`/`zinc` scales onto those tokens, so the ~1,200 pre-existing
  gray-literal utility usages across 71 files became token-driven and
  theme-aware without per-file churn. Semantic `cc-*` aliases (canvas, surface,
  elevated, hover, line, ink, accent, success, danger, warning) added for new code.
- **Trading-desk numerics.** Monospace stack + `font-variant-numeric: tabular-nums`
  on tables and `.font-mono` so odds/lines/CLV columns align.
- **IA: five zones.** Sidebar reorganized into Desk / Operations / System /
  Intelligence / Execution; legacy routes are absorbed via `match` patterns so
  no nav orphans remain.
- **Command-K palette.** New pure lib `src/lib/command-palette-model.ts`
  (ranked fuzzy match: exact > prefix > word-start > substring > subsequence;
  keyword aliases; wrap-around index) + `CommandPalette.tsx` wired into the
  shell (⌘K/Ctrl-K, arrow/enter navigation) and a "Jump to… ⌘K" trigger in the
  TopBar.

## Surfaces (foundation ported from the parked foundation branch, then fixed/hardened)

Intel zone: EV feed, arbitrage finder, middle finder, boost analyzer, sharp book
compare, line movement, team research, injury monitor, alert builder.
Execution zone: pick builder, discord preview, scheduled dispatch, results tracking.
Operations zone: outbox/delivery, approvals, discord control, results ops.
System zone: system health, governance/lane board.
Pure libs: odds-math, pick-builder-model, fire-board-model, alert-builder,
approvals-model, discord-preview-model + contract stubs (injury, boost,
scheduled-dispatch, governance) and data modules (odds-intel, execution, outbox,
results-ops, approvals-ops, discord-ops).

## Correctness fixes found by QA sweep

- **Phantom columns:** `picks_current_state` has no `event_name` /
  `event_start_time` columns; queries in `lib/data/queues.ts` and
  `lib/data/execution.ts` selected them and 42703-failed five surfaces
  (/review, /picks, /operations/approvals, /execution/results,
  /execution/discord-preview). Event context now derives from `picks.metadata`
  (fail-closed null when absent).
- **Nested `<tr>`:** `TableHead` already renders a row; two execution pages
  double-wrapped header cells, producing hydration errors. Fixed.
- **Transient statement timeouts (57014):** queue fetchers retry once, then
  fail closed; `/api-health` no longer 500s on a telemetry timeout — it renders
  an explicit "Telemetry partially unavailable" banner listing the failed reads.
- **Counts:** heavy `count: 'exact'` on the 67k-row `picks_current_state` view
  switched to `count: 'estimated'` for list totals (row data unchanged).

## Tests / tooling

- `command-palette-model.test.ts` (9 tests) added; app `test` script widened
  from 2 files to all pure-lib tests (`src/lib/*.test.ts src/lib/data/*.test.ts`,
  93 tests).
- `scripts/qa-sweep.ts`: Playwright sweep over all 28 routes — asserts HTTP 200,
  zero console/page errors, no visible `undefined`/`NaN`/`[object Object]`,
  rendered header, non-blank body; captures 1600x1000 dark full-page screenshots
  into this proof directory.

## Data contracts — fail-closed states (no fabricated data)

No runtime data source exists for: injuries, boosts, alert persistence,
scheduled dispatch (no `dispatch_after` column), governance lane board (lane
manifests live in repo docs, unreadable at app runtime). These surfaces render
designed "no data source yet" states naming the missing contract.
