# UTV2-1138 Verification

## Verification

```
npx tsx --test apps/api/src/clv-service.test.ts
pass 28, fail 0 (4 new INIT-4.3.1 hierarchy tests)

pnpm type-check
pass

pnpm test
pass

pnpm verify
EXIT:0
```

R-level compliance:

```
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Adversarial check

- opening_line_proxy has `isVerified=false` — confirmed by test 27
- market_universe_provenance has `rank=1, isVerified=true` — confirmed by test 25
- Every computed CLVResult carries `closingSourceVerification` — confirmed by test 28
- Hierarchy version `'1'` is a const — version-controlled per INIT-4.3.1 governance requirement

## SHA Binding
merge_sha: 0f56d512d5cced372b4e4ef25b35922490e32364
pr: https://github.com/griff843/Unit-Talk-v2/pull/934

Merge SHA: 61d822404759070e57d541bc3879e420c12cb632
