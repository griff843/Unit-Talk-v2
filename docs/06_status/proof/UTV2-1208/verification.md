<!-- merge_sha: placeholder-update-after-merge -->
## Verification — UTV2-1208

### pnpm verify (full pipeline)

```text
pnpm verify — PASS (exit code 0)
ops:sync-check + env:check + lint + pnpm type-check + build + pnpm test all passed
```

### pnpm type-check

```text
pnpm exec tsc -b tsconfig.json — PASS (exit 0, no errors)
```

### Tests (18/18 pass)

```text
tsx --test packages/domain/src/features/opportunity.test.ts
# tests 18
# suites 1
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Test cases — existing:
1. returns ok:false when insufficient role logs
2. computes starter probability
3. computes opportunity_projection as minutes × usage
4. role_stability is in [0, 1]
5. detects role change with significant minutes shift
6. INIT-3.1.3: usage_rate_source is "direct" when sufficient usage_rate data
7. INIT-3.1.3: usage_rate_source is "snap_share" when insufficient
8. INIT-3.1.3: snap_share fallback is replay-safe
9. INIT-3.1.3: usage_rates_sampled counts only direct observations
10. INIT-3.1.3: feature vector provenance is deterministic from same inputs

Test cases — UTV2-1208 new:
11. MOCK_FIXTURE produces a valid result with direct provenance
12. MOCK_FIXTURE has player_id provenance on all entries
13. snap_share triggers snap_share_suppressed=true (provenance flag)
14. direct usage sets snap_share_suppressed=false
15. staleness guard fails closed when all logs are stale
16. staleness guard fails closed when insufficient fresh logs remain
17. staleness guard passes when all logs are within window
18. staleness guard is a no-op when reference_date not provided

### R-level compliance

```text
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
Changed files: 2
```

### pnpm test:db (live Supabase smoke)

```text
pnpm test:db
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 108803
```

Supabase project: `zfzdnfwdarxucxtaojxm`. Live smoke passed.
No DB schema changed by this lane — domain package is pure computation.

### Constitutional constraints satisfied

- SGO activated: NO
- P3 certification advanced: NO
- P5 unfrozen: NO
- Mock/fixture data only: YES

### Tier

T1 — `packages/domain/src/features/opportunity.ts` is a Tier C path (packages/domain/src/**).
PM plan approval required before merge. Proof bundle attached.

### File scope

- `packages/domain/src/features/opportunity.ts`
- `packages/domain/src/features/opportunity.test.ts`
- `docs/06_status/proof/UTV2-1208/`
