# UTV2-1181 — Verification Log

## Summary

CR-2 — Enforce cross_domain_allowed in Authority Enforcement. Added `assertCrossDomainAllowed()` to `operator-role.ts` and wired it into `enforceAllAuthorities()` in `authority-enforcement.ts`. Roles with `cross_domain_allowed=false` are now rejected fail-closed for multi-domain operations.

## Verification

Branch SHA: `4daba080926c154bfa1c777f992a674ce12006c0`

### pnpm verify

```
pnpm verify — PASS
# tests 636
# pass 636
# fail 0
# cancelled 0
# skipped 0
```

All workspace packages passed: env:check, lint, type-check, build, test.

### T1 Proof Tests

```
tsx --test apps/api/src/t1-proof-utv2-1181-cross-domain-enforcement.test.ts

1..17
# tests 17
# pass 17
# fail 0
# duration_ms 698
```

17/17 adversarial assertions covering XD-1 through XD-6.

### pnpm test:db

```
1..7
# tests 7
# pass 7
# fail 0
# duration_ms 27476
```

7/7 live-DB smoke tests against real Supabase (project ref: zfzdnfwdarxucxtaojxm).

### R-level compliance

```
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
```
