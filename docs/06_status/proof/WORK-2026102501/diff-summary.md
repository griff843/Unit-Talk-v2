# Diff summary: WORK-2026102501

| File | Change |
|---|---|
| apps/smart-form/lib/form-utils.ts | Sport-keyed stat type to market key tables (NBA/WNBA/NCAAB basketball, NFL/NCAAF football, MLB, NHL); adds the missing catalog entries; exports `resolvePlayerPropMarketKey`, which returns null for an unmapped stat so the caller refuses explicitly; sports without a table keep the legacy flat map |
| apps/smart-form/test/form-utils.test.ts | Catalog coverage, sport-awareness, newly mapped ids, explicit refusal tests |
| apps/smart-form/e2e/phase-one.spec.ts | Row-asserted NHL Shots on Goal and NBA Points cases (market, participant, stat, line, odds, units, capper, Track Only, 0 outbox); stale wording updated to current headings |
| docs/06_status/proof/WORK-2026102501/ | Proof files |

## SHA Binding

Merge SHA: pending merge
PR: pending
