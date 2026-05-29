# UTV2-1114 Diff Summary — INIT-3.1.3 Imputation Removal

## Summary
Removes silent missing-value substitution from the feature pipeline.
Adds explicit provenance fields (usage_rate_source, usage_rates_sampled)
to OpportunityFeatures so the snap_share fallback is no longer silent.

## Scope
- packages/domain/src/features/opportunity.ts
- packages/domain/src/features/opportunity.test.ts
- packages/domain/src/models/stat-distribution.test.ts

## Verification
- pnpm verify: PASS
- scripts/ci/r-level-check.ts: PASS (no R-level artifacts required)
- 10 opportunity tests pass (5 original + 5 INIT-3.1.3)

## SHA Binding
merge_sha: beb54dd0d6b20d49fe151e7d10362863c0db644b
