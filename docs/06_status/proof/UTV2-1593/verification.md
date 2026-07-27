# PROOF: UTV2-1593 — stale hardcoded bound_at assertion in real-fixture test

MERGE_SHA: pending

## Summary

A parametrized real-fixture test in `scripts/ops/proof-generate.test.ts` hardcoded a literal `bound_at` timestamp, assuming the real committed sidecar it reads always starts unbound. Once one of the covered lanes closed via its own governed replay, its real sidecar already carried a genuine `bound_at`, and `rebindModelRoutingJsonSha` correctly treats that as idempotent-unchanged — the hardcoded literal stopped matching reality, breaking `pnpm test` on main repo-wide. Fix: assert against the real sidecar's own `closeout_binding` when already bound to the exact merge SHA under test, falling back to the injected fixture timestamp only when it isn't. This is a test-only change (`scripts/ops/proof-generate.test.ts`), zero implementation-code risk.

## ASSERTIONS

- Focused test `npx tsx --test scripts/ops/proof-generate.test.ts` passes 58/58.
- Full `pnpm verify` (env:check, lint, type-check, build, root test, live `pnpm test:db`, T1 live-proof suite) passes.
- R-level check: PASS, no artifacts required for this diff.

## EVIDENCE

Focused test run:
```
npx tsx --test scripts/ops/proof-generate.test.ts
1..58
# tests 58
# pass 58
# fail 0
```

## Verification

`pnpm test:db` (executed as part of the full `pnpm verify` run on this branch):
```
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

R-level check:
```
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```
