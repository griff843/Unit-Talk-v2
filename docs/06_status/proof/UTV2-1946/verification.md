# PROOF: UTV2-1946

Execution SHA: `cb8e405828dfb80e64475889a1fc4b425a6b3097`
MERGE_SHA: pending

## ASSERTIONS:

- [x] The default delivery exception population derives membership from the contracts-owned `isGovernedDeliveryTarget()` predicate, not a Command Center target list.
- [x] Rows and delivery counts are filtered by that same governed predicate before rendering, and the partition is applied **in the query** so counts are not capped by a row limit taken over a different population.
- [x] The three pick-based exception queues carry the shared `applyPickPopulation` predicate this lane inherits — the governed partition is positive, not the `isTestFixturePick` heuristic blocklist.
- [x] Non-governed delivery rows require the explicitly labelled diagnostic mode and are not supplied to the operational fire board.
- [x] Dead letters older than 24 hours are shown as historical records rather than live incidents.
- [x] A genuinely empty governed queue renders as an honest empty state; a failed query renders as `Partial data`, never as All Clear.

## EVIDENCE:

### The defect the review found, which the first implementation did not close

The delivery half of Exceptions was governed correctly. The **pick** half was not: `staleValidated`,
`awaitingApprovalDrift` and `rerunCandidates` read `picks` with no population predicate at all. Their
only filter was `isTestFixturePick` — a heuristic blocklist of five metadata keys plus a `/proof/i`
match on `selection` — applied *after* PostgREST had already taken `.limit(50)` from the full table.
A fixture carrying none of those five keys and not saying "proof" entered the operator fire board.

Measured read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-19:

```sql
select 'stale_validated' as queue,
  count(*) filter (where metadata ? 'distributionMode') as governed, count(*) as all_rows
from picks where status='validated' and created_at <= now() - interval '48 hours'
union all
select 'awaiting_approval', count(*) filter (where metadata ? 'distributionMode'), count(*)
from picks where status='awaiting_approval'
union all
select 'rerun_candidates', count(*) filter (where metadata ? 'distributionMode'), count(*)
from picks where approval_status='approved' and promotion_status in ('not_eligible','suppressed');
-- stale_validated   | governed 4 | all_rows 21,367
-- awaiting_approval | governed 0 | all_rows 14,984
-- rerun_candidates  | governed 0 | all_rows 89,997
```

**126,348 rows were eligible for those three queues; 4 are governed.** Two of the three governed
queues are genuinely empty, which is why the honest-empty-state assertion is load-bearing rather
than decorative: without it an empty governed queue and an unavailable query look identical.

### The delivery partition, measured in production (read-only)

```sql
with governed as (select unnest(array['discord:best-bets','discord:trader-insights',
  'discord:exclusive-insights','discord:official-picks']) as t)
select o.status, (o.target in (select t from governed)) as governed, count(*) as rows,
  count(*) filter (where o.status='dead_letter' and o.updated_at <  now() - interval '24 hours') as historical_dl,
  count(*) filter (where o.status='dead_letter' and o.updated_at >= now() - interval '24 hours') as live_dl
from distribution_outbox o group by 1,2 order by 2 desc, 1;
```

| status | governed | rows | historical DL | live DL |
|---|---|---:|---:|---:|
| `dead_letter` | yes | 340 | 340 | 0 |
| `sent` | yes | 1,565 | — | — |
| `failed` | yes | **0** | — | — |
| `dead_letter` | no | 1,614 | 1,614 | 0 |
| `sent` | no | 2,195 | — | — |
| `processing` | no | **32** | — | — |
| `pending` | no | 3 | — | — |

Live governed delivery exceptions are **0**. The 340 governed dead letters are all older than 24
hours and render as historical records. The **32 stranded `utv2-1497-canary-*` `processing` rows are
preserved untouched** — they are non-governed, they are reachable only through the labelled
diagnostic mode, and deleting them would turn a blocking readiness number green by destroying the
evidence that the classification behind it is wrong (`plan.md` §9, `intent.md` §5).

### Why the partition moved into the query

The first implementation dropped `.limit(50)` from both outbox reads and filtered in Node, so every
`failed` and `dead_letter` row (1,954 today, unbounded in principle) was fetched on each page load.
Both reads now carry `.in('target', governedOutboxTargets)` and the diagnostic read carries the
complement via `.not('target','in', …)`. `governedOutboxTargets` is derived from the contracts
registry's `governedDeliveryTargets`, so adding a governed destination there extends both sides
automatically; the in-memory `filterDeliveryTargetPopulation` is retained as defence in depth, and a
test asserts the two agree on every enumerated target.

### Negative controls

Three of the thirteen tests exist only to fail if synthetic residue can reach the operator:

- the seven real non-governed target shapes measured in production — `discord:canary`,
  `discord:recaps`, `discord:<numeric-id>` and the four `utv2-1497-canary-*` targets — must all
  partition to `non-governed`, and the two populations must partition the input exactly;
- a fixture pick carrying none of the five blocklist keys and no "proof" string must be **outside**
  the governed population, proving membership is decided positively rather than by the heuristic;
- a structural control asserts all three exception-queue `picks` reads carry `applyPickPopulation(`
  and both outbox reads carry `.in('target', governedOutboxTargets)` — so a future read added
  without the predicate fails the suite.

## Verification

- `pnpm exec tsx --test apps/command-center/src/lib/governed-population.test.ts` — PASS (13/13)
- `pnpm type-check` — PASS, exit 0
- `pnpm test` — PASS, exit 0, **6599/6599**, zero `not ok` lines
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; `operator-ui` matched
- `pnpm verify` — read from this PR's `verify` check on the branch head carrying this bundle;
  locally `ci:assert-staging` refuses any target that is not `xskgrzbteyqdufktjrjx`.

## Live DB evidence

No write was performed. Both measurements above are read-only `select` statements against production
`zfzdnfwdarxucxtaojxm` — which is the population this change governs, and the only place the 107,866
row fixture corpus and the 32 stranded canary rows actually exist. A staging count could not have
answered either question.
