# PROOF: UTV2-1593 — stale hardcoded bound_at assertion in real-fixture test

MERGE_SHA: pending

## ASSERTIONS

- A parametrized real-fixture test in `scripts/ops/proof-generate.test.ts` hardcoded a literal `bound_at` timestamp, assuming the real committed sidecar it reads always starts unbound.
- Once one of the covered lanes closed via its own governed replay, its real sidecar already carried a genuine `bound_at`, and `rebindModelRoutingJsonSha` correctly treats that as idempotent-unchanged — the hardcoded literal stopped matching reality, breaking `pnpm test` on main repo-wide.
- Fix: assert against the real sidecar's own `closeout_binding` when already bound to the exact merge SHA under test, falling back to the injected fixture timestamp only when it isn't.
- This is a test-only change (`scripts/ops/proof-generate.test.ts`), zero implementation-code risk.

## EVIDENCE

Focused test run:
```
npx tsx --test scripts/ops/proof-generate.test.ts
1..58
# tests 58
# pass 58
# fail 0
```

Full `pnpm verify` (including live `pnpm test:db` and the T1 live-proof suite): PASS.

R-level check:
```
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```
