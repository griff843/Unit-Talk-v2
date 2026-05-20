# UTV2-1038 Verification

**Issue:** UTV2-1038 — Production atomic path failure-injection proof  
**Branch:** `codex/utv2-1038-atomic-path-failure-injection-proof`  
**Tier:** T1  
**Merge SHA:** PENDING  
**Verifier:** griffadavi@gmail.com  

## Summary

`run-audit-service.ts` had a bare `catch {}` that silently fell through to sequential writes on all errors — including real DB errors (constraint violations, network timeouts, PGRST202). This violated the invariant that DB-mode errors must not silently fallback to sequential writes.

## Fix

Added `getEnqueueAtomicFallbackReason()` sentinel function that returns `'in_memory_sentinel'` only for the specific InMemory unsupported-operation message. Replaced `catch {}` with `catch (err) { if (!getEnqueueAtomicFallbackReason(err)) throw err; }`.

## Verification steps

| Step | Result |
|------|--------|
| `pnpm verify` | PASS — exit 0 |
| `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS — no R-level artifacts required |
| `npx tsx --test apps/api/src/run-audit-service.test.ts` | 7/7 PASS |
| `pnpm test:db` | 7/7 PASS (267s, against Supabase `zfzdnfwdarxucxtaojxm`) |

## Failure-injection test results

```
ok 4 - real DB errors (constraint violation) rethrow — no silent sequential fallback
ok 5 - network timeout rethrows — no silent sequential fallback
ok 6 - PGRST202 (RPC not found) rethrows — no silent sequential fallback
ok 7 - InMemory sentinel allows sequential fallback (expected dev/test path)
```

## Live-DB proof (pnpm test:db)

```
ok 1 - UTV2-852: submission atomic RPC inserts pick + lifecycle + submission_event atomically
ok 2 - UTV2-852: submitting same idempotency key twice returns identical result
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated

# tests 7
# pass 7
# fail 0
# duration_ms 266939
```
