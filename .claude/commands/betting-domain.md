# /betting-domain

Red-flag card for `@unit-talk/domain` purity. Domain is pure: no DB, no HTTP, no env, no I/O.

**Canonical reference:** `/code-structure` (architecture), `docs/CODEBASE_GUIDE.md`

---

## When this skill applies

Touching any of:
- `@unit-talk/domain` or `@unit-talk/contracts` (any file)
- `CanonicalPick`, `CanonicalPickMetadata`
- `promotionScores` (`edge | trust | readiness | uniqueness | boardFit`)
- Lifecycle states, CLV, grading, scoring weights, policy thresholds

---

## Scoring gates (do not change without PM approval)

- Best Bets minimum: `promotionScore ≥ 70`
- Trader Insights minimum: `promotionScore ≥ 80`, `edge ≥ 85`, `trust ≥ 85`
- Smart Form V1 picks without `confidence` → static fallback `61.5` → correctly suppressed
- Priority: Trader Insights > Best Bets when both qualify
- `approval_status` (`pending | approved | rejected`) and `promotion_status` (`not_eligible | eligible | qualified | promoted | suppressed | expired`) are different axes — never collapse

---

## Red flags — stop if you see these

- Scoring weight defined in `apps/api/src/**`
- App importing domain internals and re-implementing scoring
- `qualified` returned when score components are absent (must fail closed → `not_eligible` or `suppressed`)
- `async` function inside `@unit-talk/domain`
- `fetch`, `axios`, `supabase`, `pg`, or `process.env` inside `@unit-talk/domain`
- Lifecycle transition that skips a state (see `/pick-lifecycle`)

---

## Verification greps

```bash
grep -rE "from '@unit-talk/(db|config|observability)'" packages/domain/src/
grep -rE "from '(pg|@supabase/)" packages/domain/src/
grep -rE "process\.env" packages/domain/src/
grep -r "from 'apps/" packages/domain/src/
```

Each must return zero results.
