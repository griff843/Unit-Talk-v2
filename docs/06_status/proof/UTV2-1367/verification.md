# UTV2-1367 Verification — Null stake_units Constraint Loop Fix

## Summary

Guard inserted in `candidate-pick-scanner.ts` to detect `stake_units IS NULL` after
`processSubmission` returns an idempotency-collision pick. Guard links `pick_id` immediately
(breaks the retry loop), skips the lifecycle transition that triggers the NOT VALID CHECK
constraint, and emits a warn-level log for ops visibility.

**Branch:** `claude/utv2-1367-null-stake-units-constraint-loop`
**Branch HEAD SHA:** `0e5426751cdb826981e92967806899ee17570b27`
**Merge SHA:** `412fd1a8f0e65244acd6e058c2f7136095dbb7ab`
**Supabase project:** `zfzdnfwdarxucxtaojxm`
**Executor:** Claude (claude-sonnet-4-6)

## Evidence

### pnpm verify

Full verify suite run on branch (type-check + lint + build + test):

```
pnpm verify
```

Result: PASS — all checks green (type-check, lint, build, unit tests 14/14).

### Unit tests (candidate-pick-scanner.test.ts)

```
# tests 14
# pass 14
# fail 0
# skipped 0
```

Includes UTV2-1367 regression test:
- `null stake_units on idempotency collision — skipped and pick_id linked to stop retry loop`

### pnpm test:db (live Supabase)

Command: `pnpm test:db`
Test file: `apps/api/src/database-smoke.test.ts`
Supabase project: `zfzdnfwdarxucxtaojxm`

```
# tests 7
# pass 7
# fail 0
# skipped 0
```

Note: First run failed 4/7 with statement timeout on UTV2-996 correction chain (Supabase transient
degradation, unrelated to this fix). Re-run confirmed 7/7 pass.

## Verification

**Verdict: PASS**

All checks green:
- `pnpm verify`: PASS (type-check + lint + build + test 14/14)
- `pnpm test:db`: PASS (7/7 against real Supabase — not in-memory)
- Root cause confirmed: `picks_stake_units_canonical_check NOT VALID` fires on any `UPDATE picks`
  row where `stake_units IS NULL`, blocking lifecycle transitions and causing infinite retry
- Fix confirmed: null-stake-units guard prevents the lifecycle transition, links `pick_id` to stop
  the 60s retry loop, logs warn-level for ops visibility
- DB backfill of 2,902 legacy picks is PM-gated and tracked in UTV2-1367 scope
