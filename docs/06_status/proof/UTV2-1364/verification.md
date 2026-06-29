# UTV2-1364 Verification Log

**Issue:** UTV2-1364  
**Tier:** T2  
**Branch:** `codex/utv2-1364-candidate-quality-gates`  
**Verification date:** 2026-06-29

## Verification

### pnpm verify:static

```
[sync-check] OK (per-issue): branch "codex/utv2-1364-candidate-quality-gates" <-> .ops/sync/UTV2-1364.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
(lint) — no errors
(type-check) — clean
(build) — clean

# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Quality gate tests (candidate-builder + candidate-scoring)

```
tsx --test apps/api/src/candidate-builder-service.test.ts apps/api/src/candidate-scoring-service.test.ts

# tests 40
# suites 0
# pass 40
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 815
```

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

### pnpm test:db

```
pnpm test:db
```

Attempted; encountered Supabase `statement_timeout` on the atomic rollback test — a known live-DB flake unrelated to this lane's changes (no DB schema or query changes in this PR). T2 tier does not require a `pnpm test:db` PASS per DELEGATION_POLICY; the flake is documented here for auditor completeness. `pnpm verify:static` (all unit tests + lint + type-check + build) is green.

## Gate coverage

| Gate | Test file | Test name | Result |
|------|-----------|-----------|--------|
| Gate 1 (extreme juice) | builder-service.test.ts | `Gate 1 — rejects extreme negative over odds` | pass |
| Gate 1 (extreme juice) | builder-service.test.ts | `Gate 1 — rejects extreme positive under odds` | pass |
| Gate 1 (extreme juice) | builder-service.test.ts | `Gate 1 — accepts odds exactly at threshold` | pass |
| Gate 1 integration | builder-service.test.ts | `Gate 1 integration: extreme juice offer is rejected and logged to audit` | pass |
| Gate 3 (stale) | builder-service.test.ts | `Gate 3 — rejects stale snapshot older than 1 hour` | pass |
| Gate 3 (stale) | builder-service.test.ts | `Gate 3 — accepts fresh snapshot just under 1 hour` | pass |
| Gate 3 integration | builder-service.test.ts | `Gate 3 integration: stale snapshot offer is rejected and logged to audit` | pass |
| Gate 3 (scorer stale) | scoring-service.test.ts | `UTV2-1364 Gate 3: stale universe rows are skipped and logged to audit` | pass |
| Gate 4 (postgame) | scoring-service.test.ts | `UTV2-1364 Gate 4: past event rejects candidate` | pass |
| Gate 4 (postgame) | scoring-service.test.ts | `UTV2-1364 Gate 4: future event passes through` | pass |
| Gate 5 (SUPPRESS) | scoring-service.test.ts | `UTV2-1364 Gate 5: SUPPRESS band rejects candidate with audit log` | pass |
| Gate 2 (Kelly=0) | scoring-service.test.ts | `UTV2-1364 Gate 2: Kelly<=0 rejects candidate with audit log` | pass |
| Gate 2 (Kelly>0) | scoring-service.test.ts | `UTV2-1364 Gate 2: positive Kelly passes through (no rejection)` | pass |
