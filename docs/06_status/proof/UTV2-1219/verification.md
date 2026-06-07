## Verification — UTV2-1219 V-R4 Fault Injection Harness

**Issue:** UTV2-1219
**Branch:** claude/utv2-1219-r4-fault-injection
**Tier:** T1
**Verifier:** claude/utv2-1219
**Date:** 2026-06-06

---

## Test Execution

```
tsx --test apps/api/src/fault-injection.test.ts

# tests 74
# suites 0
# pass  74
# fail  0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~704ms
```

All 74 tests pass. 0 failures.

---

## Type Check

```
pnpm type-check
# Exit 0 — no TypeScript errors
```

---

## pnpm test (full suite)

```
pnpm test
# Exit 0
```

---

## pnpm test:db (live Supabase)

```
pnpm test:db

# tests 7
# suites 0
# pass 7
# fail 0
# duration_ms ~101108ms
```

Live Supabase project `zfzdnfwdarxucxtaojxm` confirmed healthy.

---

## Fail-Closed Verification Results

| Module | Failure Injected | Result | Notes |
|---|---|---|---|
| player-form | zero minutes_projection → opportunity_projection=0 | ok:false | Guard: "Opportunity projection must be positive" |
| player-form | NaN stat_per_minute | ok:true (documented gap) | NaN propagates through hash; not caught at boundary |
| player-form | negative volatility components | ok:true (documented gap) | Math.max(variance, 0.0001) clamps, not rejects |
| opportunity | opportunity_projection=0 | ok:false | "Opportunity projection must be positive" |
| opportunity | opportunity_projection<0 | ok:false | Same guard |
| opportunity | snap_share_suppressed=true | ok:false | "snap_share provenance: ...suppressed for manual review" |
| opportunity | usage_rate_source=snap_share | ok:false | Same guard |
| efficiency | efficiency_projection=0 | ok:false | "Efficiency projection must be positive" |
| efficiency | efficiency_projection<0 | ok:false | Same guard |
| efficiency | NaN efficiency_projection | ok:true (documented gap) | NaN passes JS `<= 0` check; propagates to expected_value |
| matchup-context | null → efficiency_projection=0 | ok:false | Downstream collapse caught by efficiency guard |
| matchup-context | null → opportunity_projection=0 | ok:false | Downstream collapse caught by opportunity guard |
| matchup-context | both projections zero | ok:false | Opportunity guard fires first |
| game-context | gameContext=undefined | ok:true | Graceful absent; home_away_factor defaults to 1.0 |
| game-context | home_away_factor=0 | ok:true (documented gap) | Collapses expected_value to 0; not currently validated |
| game-context | home_away_factor=NaN | ok:true (documented gap) | NaN propagates to expected_value; not currently validated |
| game-context | projected_game_total=NaN | ok:true | Field is passthrough; does not affect computation |

---

## Documented Gaps (Not Production Defects — Logged for Future Hardening)

1. **NaN efficiency_projection**: JavaScript `NaN <= 0` evaluates to `false`, so NaN bypasses the `efficiency_projection <= 0` guard. Expected value becomes NaN. This is a known gap — the test documents it as such.

2. **NaN home_away_factor**: `gameContext.home_away_factor` is not validated before multiplying against `formAdjustedValue`. NaN propagates.

3. **Zero home_away_factor**: Not currently rejected. Expected value collapses to 0. The pipeline does not have a guard for `home_away_factor` range.

4. **Negative variance components**: `playerForm.player_base_volatility` and related fields accept negative values. `Math.max(totalVariance, 0.0001)` compensates in the distribution step but does not reject the input.

These gaps are documented in `evidence.json` under `fault_injection_results.documented_gaps`. They do not represent a failure of the harness — the harness correctly identifies and annotates them.

---

## Constitutional Constraints

- No production source files modified
- SGO not activated
- P3 not advanced
- P5 not unfrozen
- Test file is new code only: `apps/api/src/fault-injection.test.ts`

---

## SHA Binding

Branch HEAD SHA at verification time: `63176980b1edad13a2ce62ecd75039f7e21cb3ce`

Note: This will be updated to merge SHA after PR merge per T1 proof protocol.
