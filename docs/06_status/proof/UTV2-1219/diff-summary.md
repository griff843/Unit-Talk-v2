# Diff Summary — UTV2-1219 V-R4 Fault Injection Harness

**Issue:** UTV2-1219
**Branch:** claude/utv2-1219-r4-fault-injection
**Tier:** T1

---

## Files Changed

### New File: `apps/api/src/fault-injection.test.ts`

Fault injection test harness for the Wave-5 scoring pipeline. Tests that
`computeStatProjection` fails closed (returns `{ ok: false, reason: string }`)
when each of the 5 Wave-5 feature modules returns malformed, null, or zero output.

**No production source files were modified.**

---

## Scope

Per PM authorization (2026-06-07):

- Inject controlled failures at each of the 5 Wave-5 feature module callsites in `computeStatProjection`
- Assert that `computeStatProjection` throws or returns a fail-closed sentinel
- Cover NBA, NFL, MLB, NHL
- Test harness only — no deployment, no production code change

---

## Test Coverage

| Category | Count |
|---|---|
| Baseline (4 sports × 1) | 4 |
| player-form injections | 9 |
| opportunity injections | 16 |
| efficiency injections | 12 |
| matchup-context injections | 12 |
| game-context injections | 16 |
| line guard (4 sports) | 4 |
| sentinel (never-qualified check) | 1 |
| **Total** | **74** |

---

## Fail-Closed Results

The following injection paths reliably return `ok:false`:

- `opportunity_projection <= 0` (zero, negative, downstream matchup-context collapse)
- `efficiency_projection <= 0` (zero, negative, downstream matchup-context collapse)
- `snap_share_suppressed === true`
- `usage_rate_source === 'snap_share'`
- `line < 0`

The following injection paths are **documented as gaps** (current behavior, not rejections):

- NaN `efficiency_projection` (passes JS `<= 0` check)
- NaN / zero `home_away_factor`
- Negative variance components (clamped, not rejected)

These gaps are annotated in test assertions with clear comments — not asserted as passing behavior.

---

## Production Code Impact

None. This PR adds one new test file only.
