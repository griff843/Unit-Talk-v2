# PROOF: UTV2-1942

MERGE_SHA: pending merge

Generated at: 2026-09-19T04:05:00.000Z
Issue: UTV2-1942
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1942-command-center-operator-latency
PR URL: PENDING
Head SHA: PENDING
result: pass

## ASSERTIONS:

- [x] The root layout no longer performs a database read. `getPrivilegedGlobalHealth()` —
      which is `getDashboardData()`, eighteen queries — ran on every request the middleware
      matcher admitted, including 404s that run no page query at all. It is gone;
      `CommandCenterShell` receives `initialHealth={null}` and resolves health client-side
      through `/api/health`, which it already fetched on mount and every 30s behind that
      route's own 30s cache.
- [x] No consumer reads `system_runs` with a global ordering any more. `snapshot.ts`,
      `pipeline-health.ts` and `intelligence.ts` all go through `fetchObservedRuns`, which
      issues one `run_type`-pinned query per consumed type against
      `system_runs_run_type_started_at_idx`.
- [x] `fetchObservedRuns` fails closed: one failing sub-query returns `{data: null, error}`
      rather than a partial merge that would read exactly like a healthy system with nothing
      to show.
- [x] `searchPicks` reports the same exact total it reported before, taken against `picks`
      instead of `picks_current_state`. Not an estimate, not a page-length fallback.
- [x] `getReviewQueue` and `getHeldQueue` are deliberately unchanged. Both filter on
      `review_decision`, which the view produces from its `pick_reviews` lateral, so their
      counts cannot move off the view without changing what they count.
- [x] Every route now has a transition boundary. `src/app/loading.tsx` covers the ~53 routes
      that declared none; the two that declared their own still take precedence.
- [x] No DDL, no migration, no index, no retention change, no data deleted. `system_runs`
      retention and any new index are reserved decision 1 and are untouched.
- [x] No change to delivery authority, containment, the kill switch, grading, settlement
      semantics, or any write path. The diff is entirely under `apps/command-center/`.
- [x] The route sweep's own findings were re-measured before being recorded. Five of its
      twelve failures were harness artifacts — a 2.5s hydration window shorter than the
      client bundle's load time, and one route that failed only by run position — and are
      recorded as corrections rather than as defects. Four of those five are
      `redirect('/api-health')` stubs, so they were never four findings.
- [x] Mutation drill: reverting `fetchObservedRuns` to the pre-fix global read fails 3 of its
      5 tests. The 2 that stay green are properties the old code also had — recorded rather
      than hidden, because a suite that went 5/5 red would mean the tests were measuring the
      rewrite rather than the defect.

## EVIDENCE:

### 1. The root layout was the dominant cost on every route

A root layout runs for every request the middleware matcher admits. It is not a page, and
Next does not skip it for a 404. Measured through the operator bridge against the deployed
Command Center:

```
$ curl -o /dev/null -w '%{time_total}\n' <cc>/_next/static/...      0.002s   (no layout)
$ curl -o /dev/null -w '%{time_total}\n' <cc>/nonexistent-xyz       5.49s    (404, layout only)
$ curl -o /dev/null -w '%{http_code} %{time_total}\n' <cc>:4300/    401 0.004s (refused at middleware)
```

The 404 runs no page query whatsoever. The 5.49s is the layout's health read alone, and every
one of the 55 routes paid it before its own query even started.

### 2. `system_runs`: the slowest query in the app returned nothing usable

Read-only against production `zfzdnfwdarxucxtaojxm`.

```sql
explain (analyze, buffers)
select * from system_runs order by created_at desc limit 26;
-- Parallel Seq Scan over 3,516,347 rows -- 11,501 ms
```

Ordering by `started_at` instead does not help: the only composite index leads with
`run_type`, so neither ordering column is indexable on its own. That correction matters —
an earlier reading of this defect blamed the ordering column and was wrong.

The composition of the table is what makes the read vacuous as well as slow:

```sql
select run_type, count(*) from system_runs group by run_type order by 2 desc;
-- worker.heartbeat   3,429,120   (97.5%)
```

Written every ~6s since 2026-04-21 with no retention. So all 26 rows the query returned were
heartbeats, and `latestDistributionRunAt`, `latestIngestorRunAt`, `failedRuns` and the
alert / grading / recap / provider-quota summaries were **structurally always null, zero or
empty** while looking like successful reads. This is the failure mode the tests target: it
produces no error.

The replacement, using the existing `system_runs_run_type_started_at_idx`:

```
7-type lateral-limit form: 182 rows across every consumed run type -- 98.8 ms
```

### 3. `searchPicks`: the count exceeded the statement timeout outright

```sql
select count(*) from picks_current_state;   -- 8,979 ms
select count(*) from picks;                 --    47 ms   (index-only scan)
```

`picks_current_state` carries three correlated laterals
(`pick_promotion_history`, `settlement_records`, `pick_reviews`). Counting the view runs all
three once per candidate row — 107,866 times — purely to discard every column they produce.
The `authenticated` role's statement timeout is 8s (`anon` 3s, `service_role` null), so
`/picks` and `/picks-list` rendered a raw `canceling statement due to statement timeout`
rather than any data.

Row-count equality is structural, not coincidental: every join in the view is a `LEFT JOIN`,
and the three correlated ones are `LEFT JOIN LATERAL (… LIMIT 1) ON true`, so none can drop a
`picks` row or emit two. Verified on three predicates regardless:

| predicate | `picks_current_state` | `picks` |
|---|---|---|
| unfiltered | 107866 | 107866 |
| `source = 'smart-form'` | 62629 | 62629 |
| `status='settled' and created_at >= '2026-01-01'` | 18287 | 18287 |

The remaining condition — that no `searchPicks` filter reads a joined column — is not
structural and is the one a later change could break silently. It is now mechanical:
`SEARCH_PICKS_FILTER_COLUMNS` is *derived* from the filter tables that `applyFilters` is built
from, and `queues-count-relation.test.ts` asserts it is disjoint from `VIEW_DERIVED_COLUMNS`.

### 4. The click symptom: no route-transition boundary

The reported symptom was "it loads but no buttons work". The three defects above explain
latency. They do not by themselves explain a click doing nothing, because Next does not
re-render a root layout on client-side navigation — the 5.49s is paid on full loads.

Read from the source rather than inferred:

- The App Router renders nothing during a route transition unless the segment or an ancestor
  declares `loading.tsx`. It keeps the **previous** page mounted, painted and interactive,
  and swaps it only when the new RSC payload arrives.
- `find src/app -name loading.tsx` returned **2** files, for ~55 routes:
  `decision/preview` and `decision/routing`.
- `CommandCenterShell` reads `usePathname()`, which does not change until the navigation has
  already committed, and holds no `useTransition` or pending state. There is no root
  `template.tsx`.

So for the whole server render the operator saw the page they clicked away from — no spinner,
no skeleton, no disabled state, no URL change. On the heaviest pages that render was 8–15s.
`src/app/loading.tsx` covers the rest.

### 5. Mutation drill — `fetchObservedRuns`

Replace the fan-out with the pre-fix global read, run, restore:

```
$ pnpm exec tsx --test src/lib/data/observed-runs.test.ts          # MUTATED
not ok 1 - surfaces run types that a global ordering buries under worker.heartbeat
not ok 2 - issues one run_type-filtered query per observed type, each with its own limit
not ok 5 - fails closed: one failing sub-query returns an error, never a partial read
# pass 2
# fail 3

$ pnpm exec tsx --test src/lib/data/observed-runs.test.ts          # RESTORED
# pass 5
# fail 0
```

The two that stayed green — descending merge order, and `since` passthrough — are properties
the pre-fix code also satisfied. Recording that is the point: it shows the three that failed
are sensitive to the actual defect rather than to the rewrite.

### 6. Local latency measurements were taken and DISCARDED

A local Next server was stood up on port 4310 against this branch. Its numbers
(`/` 0.38s, a 404 0.11s, `/picks` 0.14s) are **not evidence of anything** and are recorded
here only so they are not mistaken for evidence later: `local.env` pins
`SUPABASE_URL=http://127.0.0.1:1`, so the page rendered
`Active picks unavailable — searchPicks: TypeError: fetch failed`. Those timings measure a
TCP connection refusal, not a query.

Two facts the local run *did* establish, both structural rather than timed:

- The RSC payload contains `"initialHealth":null`, and the 404 path rendered with no health
  read on it — the layout change takes effect as intended.
- Unauthenticated `GET /` returned **401** and authenticated returned 200, so the fail-closed
  request-auth boundary is intact under the changed layout.

### 7. Deployed-route sweep (read-only) — a BASELINE, not a verification of this change

A serial Playwright sweep of all 55 routes against the deployed Command Center.

**What it does and does not establish.** It runs against the deployed release, which does not
contain this branch. It is therefore a measurement of the *pre-fix* system: it records which
routes currently render a statement timeout, which hydrate, and what each costs. It cannot
confirm that this change fixes them.

That gap is bounded and is not closable from here. `getDataClient()` opens its connection with
the **service-role** key, so standing a local server up against real data would require the
production service-role secret — reserved decision 4. It was not obtained and no attempt was
made to work around it. `local.env` pins `SUPABASE_URL=http://127.0.0.1:1`, which is why §6's
local timings are worthless.

**Smallest operator action that closes it:** deploy `main` once this merges (reserved action
8), then re-run this same spec against the deployed Command Center and diff it against the
baseline below. **Non-secret success criterion:** the routes recorded here as rendering
`canceling statement due to statement timeout` render data instead, and a request to a
nonexistent path returns in well under one second rather than 5.49s.

Two properties of the method, both of which correct earlier mistakes:

- **1 worker, `fullyParallel: false`.** A parallel sweep of this app measures the database's
  queue depth under N concurrent operators, not the app's latency. A 4-worker run on
  2026-09-18 produced a false "6 routes never load (90s timeout)" reading; all six are
  `redirect()` stubs that resolve in 9.4–18.2s serially.
- **It never clicks an operator mutation.** Settle, approve, deny, retry, requeue, rerun and
  override are all one click away on these pages. The spec matches a mutation vocabulary
  first and skips anything it matches, and only interacts with an explicit safe allowlist
  (tabs, filters, sort, expand/collapse, pagination). A control matching neither list is
  skipped — the allowlist is the decision, not the denylist.

It also asserts **hydration** rather than clicking everything: it walks the DOM for a React
fiber, which answers "would any button work here" without invoking one.

**First reading: 55 routes, 43 passed, 12 failed, 21.0m wall clock, 1 worker.** That
reading was then re-measured, and **five of the twelve failures were artifacts of this
harness, not defects in the app.** What follows records both, because the correction is
the more useful half.

### The seven real failures: a rendered database statement timeout

`/decisions` 26.6s · `/held` 22.9s · `/intelligence/attribution` 21.9s ·
`/operations/approvals` 22.9s · `/picks` 22.7s · `/picks-list` 28.8s · `/review` 23.1s

Each loads and paints, and where the data should be prints
`canceling statement due to statement timeout`. Six printed both that string and
`statement timeout`; `/held` printed only the latter. This is the §3 defect measured
from the browser: the count against `picks_current_state` was 8,979ms against the 8s
`authenticated` timeout, and `/picks` and `/picks-list` are named in both places.

### The five that were not failures

`/agents` · `/api-health` · `/ops` · `/runtime-dashboard` · `/burn-in`

The first reading classified four of these as *"React never hydrated"* and the fifth as
a 120s timeout. Both classifications were wrong, and neither was a close call:

- **Four of the five are `redirect('/api-health')` stubs**, six lines long, with no
  controls of their own (`src/app/{agents,ops,runtime-dashboard,burn-in}/page.tsx`). They
  are not four independent findings; they are one page, reached four ways.
- **All five hydrate.** The first reading probed for a React fiber 2.5s after
  `domcontentloaded`. Re-measured with `waitUntil: 'load'` and a 30s poll, every one
  attached: `/` at 9.7s, `/api-health` at 9.6s, `/agents` at 14.6s, `/ops` at 14.4s,
  `/runtime-dashboard` at 14.7s, `/burn-in` at 14.2s — all with zero page errors. The
  2.5s window was shorter than the bundle's download-and-execute time over the operator
  SSH bridge, so the assertion was measuring the window.
- **`/burn-in`'s timeout was run position, not the route.** Run alone it passed three
  times out of three (14.1s, 14.1s, 14.4s). It timed out only as a later route inside a
  longer serial run. `curl` puts it at a 307 to `/api-health` in 6.9s, identical to
  `/agents`.

**The correction does not soften the operator's report — it relocates it.** "Buttons
don't work" is real, and the re-measurement shows why: React attaches **9.6 to 14.7
seconds** after navigation begins. Every click before that lands on server-rendered HTML
with no handler bound and is silently dropped. That is latency, which is what §1–§3
measure and what this change removes, plus §4's boundary so the wait is at least visible.
It is not an inert client bundle, and a fix aimed at hydration would have been aimed at
nothing.

### What the sweep does and does not establish

It ran against the deployed release, which does not contain this branch, so it measures
the **pre-fix** system. It cannot confirm that this change fixes anything. That gap is
bounded and not closable from here: `getDataClient()` opens its connection with the
**service-role** key, so a local server against real data would need the production
service-role secret — reserved decision 4. It was not obtained and not worked around.

**Smallest operator action that closes it:** deploy `main` once this merges (reserved
action 8), then re-run the same spec and diff it against this baseline.
**Non-secret success criterion:** the seven routes above render data instead of
`canceling statement due to statement timeout`, a request to a nonexistent path returns
in well under one second rather than 5.49s, and the hydration probe reports attachment
materially earlier than 9.6–14.7s.

### Two method properties, both of which correct earlier mistakes of mine

- **1 worker, `fullyParallel: false`.** A parallel sweep of this app measures the
  database's queue depth under N concurrent operators, not the app's latency. A 4-worker
  run on 2026-09-18 produced a false *"6 routes never load (90s timeout)"* reading; all
  six are the `redirect()` stubs above.
- **It never clicks an operator mutation.** Settle, approve, deny, retry, requeue, rerun
  and override are all one click away on these pages. The spec matches a mutation
  vocabulary first and skips anything it matches, and interacts only with an explicit
  safe allowlist. A control matching neither list is skipped — the allowlist is the
  decision, not the denylist.

**And a third, learned here: an assertion whose threshold is shorter than the thing it
measures reports a defect that does not exist.** Five of twelve failures came from a
2.5s constant and a serial run position. The absolute durations below include the SSH
bridge and the spec's own settle waits, so they are **not** server render times and must
not be quoted as such; only the classifications and the relative ordering are
load-bearing. Every route, passing or failing, took at least 16.6s in the sweep, with
`/interventions` slowest at 32.6s.

**One artifact did not survive.** `results/audit.json` recorded only the last route,
because Playwright restarts its worker process after each failure and that reset the
spec's module-level accumulator. The per-route detail above is recovered from the run
log, which is the authoritative record of the sweep; the JSON is not.

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base 45fcbc207 --head <head>
Verdict: PASS
Changed files: 14
Rules matched: operator-ui
```

Run with explicit SHAs, never `--head HEAD`: `scripts/ci/r-level-check.ts` resolves its
repo root from its own file location and runs `git diff` with `cwd: repoRoot`, so from a
lane worktree `HEAD` silently resolves in the root checkout instead.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test` (`@unit-talk/command-center`): exit 0 — 590 tests, 590 pass, 0 fail
- [x] `pnpm verify:static`: exit 0 — lint + type-check + build + full test suite +
      smart-form verify + verify:commands
- [ ] `pnpm verify`: cannot exit 0 from this containment-isolated checkout. Its
      `ci:assert-staging` step refuses with
      `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx`, because `local.env`
      pins `SUPABASE_URL=http://127.0.0.1:1`. Every gate before it passed; `verify` itself is
      executed by CI on the PR.
- [x] Mutation drill on `fetchObservedRuns`: 3 of 5 tests invert, 2 correctly do not

## Runtime Verification

This lane is T2 and changes only how `apps/command-center` reads. It adds no write path, no
new table, no migration and no DDL, and it changes no containment setting, kill switch or
delivery target.

The runtime facts it depends on are recorded above as **production measurements** —
`explain (analyze)` timings, the 97.5% heartbeat composition, the three count-equality
predicates, and the read-only route sweep — rather than as a live-DB test. All were executed
against production `zfzdnfwdarxucxtaojxm` read-only: zero rows written, updated or deleted,
and no operator mutation control was ever clicked.

`result: pass` refers to the static gates, the mutation drill and those measurements, all of
which were executed rather than asserted. No live-DB write proof is claimed.

**These changes are not in production.** `main` establishes integrated code; only a
successful `Deploy` run establishes what is executing. Dispatching that deploy is reserved
action 8.

## Merge SHA Binding

Merge SHA: pending merge
PR: PENDING
Approved PR head: PENDING
Execution SHA: 04cdcf451b9ed776c3224e12036cc4aaa5084df3
