## Verification — UTV2-1215

**Issue:** UTV2-1215 — Wave 5 game-context wiring alongside efficiency  
**Branch:** `claude/utv2-1215-game-context-wiring`  
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/979  
**Tier:** T1 — modeling lane

---

## pnpm verify

```
# tests 116
# suites 13
# pass 116
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Exit code: 0 — all tests pass, lint/type-check/build green.

## pnpm test:db

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100400.670124
```

All 7 live Supabase smoke tests pass against project `zfzdnfwdarxucxtaojxm`.

## R-level compliance

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## New tests (3)

```
describe('game-context wiring — UTV2-1215')
  ✓ back-to-back (rest_days:0) → is_back_to_back:true in output
  ✓ home factor (1.012) → expected_value increases ~1.2% vs neutral
  ✓ no gameContext → game-context fields absent, expected_value unchanged
```

## Files changed

- `packages/domain/src/models/stat-distribution.ts` — game context wiring
- `packages/domain/src/models/stat-distribution.test.ts` — 3 new tests

## Constitutional constraints

- SGO: NOT activated
- P3 cert: NOT advanced
- P5: FROZEN_NOT_CERTIFIED (unchanged)
- Deterministic scoring preserved: home_away_factor included in feature vector hash
