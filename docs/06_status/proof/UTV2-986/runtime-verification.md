---
schema: runtime-verification-v1
issue: UTV2-986
tier: T1
branch: claude/utv2-986-kelly-sizing-metadata-path
sha: 382afcd37ee8e87437cc6e1e523f112a9a2d3f79
---

## Runtime Verification

Branch HEAD: `382afcd37ee8e87437cc6e1e523f112a9a2d3f79`

### Pre-merge Checklist

- [x] `pnpm verify` green (64/64 promotion-edge-integration tests, verify passed)
- [x] `pnpm test:db` 7/7 against live Supabase (`zfzdnfwdarxucxtaojxm`)
- [x] R-level check: PASS — rule `promotion-scoring`
- [x] `t1-proof-utv2-986-kelly-readiness.test.ts` included in PR diff (3/3 pass locally)
- [x] `docs/06_status/proof/UTV2-986/evidence-bundle.md` created

### Behavioral Change Verified

**Before (silent dead path):** `readKellyGradientReadiness()` read `kellySizing['kellyFraction']`
which does not exist in `KellySizingResult`. The primary Kelly path was dead on every pick.
Promotion scoring always fell through to `domainAnalysis.kellyFraction` fallback, or returned null.

**After (fix):** `readKellyGradientReadiness()` reads `kellySizing['fractional_kelly']`, which
is the correct field per `KellySizingResult` interface. Picks with real Kelly sizing (those with
matching provider offers) now correctly contribute their Kelly gradient to promotion readiness.
Picks without Kelly sizing continue to use the fallback — unchanged behavior.

### Proof Test Results

`t1-proof-utv2-986-kelly-readiness.test.ts` (against local Supabase):

```
  UTV2-986 kelly primary path OK — pickId=ffc6efea-98a9-49a4-8cf7-67e1d916ef4c primaryReadiness=53
✔ UTV2-986: readKellyGradientReadiness reads fractional_kelly (primary path, not legacy kellyFraction)
  UTV2-986 promotion pipeline OK — pickId=beea0369-1f5f-4335-aa09-85e64b36ffa9 status=not_eligible
✔ UTV2-986: evaluateAndPersistBestBetsPromotion runs to completion with live DB pick
✔ UTV2-986 proof created pick ids (diagnostics)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

### Live DB Proof

`pnpm test:db` output (7/7 pass):

```
✔ database repository bundle persists a submission and settlement when Supabase is configured (41028ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (38921ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (44420ms)
✔ UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row (41694ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (731ms)
✔ UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows (42824ms)
✔ UTV2-996: correction chain is additive — original settlement row is not mutated (41494ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

### Field Name Fix Summary

```diff
- const fraction = kellySizing['kellyFraction'];   // non-existent field
+ const fraction = kellySizing['fractional_kelly']; // correct KellySizingResult field
```

`fractional_kelly = raw_kelly × kelly_multiplier` — the post-multiplier fraction used for
bet sizing. This is the signal that belongs in promotion readiness scoring.
