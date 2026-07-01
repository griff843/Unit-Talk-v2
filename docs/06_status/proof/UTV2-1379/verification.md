# UTV2-1379 — domainAnalysis Population / Confidence-Delta Fallback

## Verification

Placeholder — real assertions and content populated during implementation, before PR open.

## Summary

T1 investigation + fix lane for the domainAnalysis/confidence-delta fallback (92.4% of picks). Root cause already established via read-only investigation (see Linear comment / lane history): smart-form submissions never include confidence, skipping both confidence-delta and real-edge computation at submission time; enrichPickAtPromotionTime() checks domainAnalysis == null which is virtually always false by promotion time, making the DEBT-019 enrichment a no-op.

## Evidence

pnpm test:db (live Supabase zfzdnfwdarxucxtaojxm), rerun 2026-07-01:
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 192232.426597
```
