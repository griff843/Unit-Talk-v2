# PROOF: UTV2-1944

Execution SHA: `0e2f62ffd23e5874110359126d4568886a4e2672`
MERGE_SHA: pending merge

## ASSERTIONS:

- Pick discovery selects the governed cohort by one positive predicate applied to **both** the row
  read and the count read, so the explorer's total and its rows describe the same population.
- Every `picks` read on a presented analytics surface — performance, leaderboard, intelligence —
  carries that same predicate, and governed membership is the **driving** predicate for the
  settlement join rather than a join enrichment that a missing row can silently default.
- The fixture corpus is reachable only under an explicit, labelled mode, and every row it shows is
  marked as a fixture.

## EVIDENCE:

### The defect this closes

`searchPicks` applied only caller-supplied filters. With no filter set — the default explorer view —
it returned rows from `picks_current_state` and a count from `picks` across the **entire** table.
Measured against production `zfzdnfwdarxucxtaojxm`, that is 107,866 rows, of which 8 are governed
operator submissions. The operator surface therefore presented ~99.99% CI fixtures as real picks,
which `COMMAND_CENTER_PRODUCT_CONTRACT.md` §8.2 forbids.

### Predicate equivalence, measured in production (read-only)

The helper emits the PostgREST form `metadata->distributionMode=not.is.null`. The canonical
predicate recorded in `docs/mission/plan.md` §3 is the jsonb form `metadata ? 'distributionMode'`.
They must agree, and a `->` returning a JSON `null` for a present-but-null key is exactly where such
a pair usually diverges. Both were run against production in one statement:

```sql
select
  count(*) filter (where metadata ? 'distributionMode')          as jsonb_exists_predicate,
  count(*) filter (where (metadata->'distributionMode') is not null) as postgrest_not_is_null,
  count(*)                                                       as total
from picks;
-- jsonb_exists_predicate = 8 | postgrest_not_is_null = 8 | total = 107866
```

8 = 8. The deployed predicate selects the same cohort the mission plan names, and the default
explorer population is 8 rather than 107,866.

### Settlement reconciliation, measured in production (read-only)

```sql
select
  count(*)                                                                         as settled_30d,
  count(*) filter (where p.metadata ? 'distributionMode')                          as governed,
  count(*) filter (where p.id is null)                                             as orphan_pick,
  count(*) filter (where p.id is not null and not (p.metadata ? 'distributionMode')) as fixture_backed
from settlement_records s
left join picks p on p.id = s.pick_id
where s.status = 'settled' and s.created_at >= now() - interval '30 days';
-- settled_30d = 6 | governed = 6 | orphan_pick = 0 | fixture_backed = 0
```

**Stated honestly: performance is not currently wrong.** All 6 settlements in the window are already
governed, so the aggregate figures the Command Center renders today reconcile with or without this
change. The analytics half of this lane is a correctness guard against the population growing, not a
repair of a currently-visible number. Claiming otherwise would be a fabricated result.

### The join-layer defect found in review and repaired

The first implementation filtered the `picks` read but kept `const pick = picksMap.get(pickId) ?? {}`
at the join. Because `picksMap` now holds governed rows only, a fixture settlement's pick is absent —
and `?? {}` substitutes a truthy empty object that passes `isTestFixturePick`, so the settlement
survived and was counted with `_source: 'unknown'`, `stake_units: null` and `odds: null`, distorting
units and ROI. Filtering the enrichment while leaving the driver unguarded reintroduces the same
class of defect one layer down.

The rule is now one exported function, `resolveGovernedPick`, used at all three join sites
(`getPerformanceData`, `getLeaderboard`, `getIntelligenceData`), returning `null` for a
non-governed pick so the settlement is dropped. `getIntelligenceData`'s own `picks` read did not
carry the predicate at all and now does.

## Verification

- `pnpm type-check` — PASS
- `pnpm exec tsx --test apps/command-center/src/lib/governed-population.test.ts` — PASS (6/6)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; matched `operator-ui`
  with no required artifacts.
- `pnpm verify` — read from this PR's `verify` check on the branch head carrying this bundle.

Two of the six tests are new and cover the repair above: one asserts that a settlement whose pick is
outside the governed map resolves to `null` and is dropped rather than defaulted, and one asserts
that the number of `.from('picks')` reads in `analytics.ts` equals the number of
`applyPickPopulation(` calls — so a future `picks` read added without the predicate fails the suite —
and that the literal `picksMap.get(pickId) ?? {}` form does not reappear.

## Live DB evidence

No write was performed. Both measurements above are read-only `select` statements against production
`zfzdnfwdarxucxtaojxm`, which is the population this change governs; a staging count would not have
answered the question, because the 107,866-row fixture corpus is a production artifact.
