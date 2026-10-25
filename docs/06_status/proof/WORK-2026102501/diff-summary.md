# Diff summary: WORK-2026102501

| File | Change |
|---|---|
| apps/smart-form/lib/form-utils.ts | Sport-keyed stat type to market key tables (NBA/WNBA/NCAAB basketball, NFL/NCAAF football, MLB, NHL); adds the missing catalog entries; exports `resolvePlayerPropMarketKey`, which returns null for an unmapped stat so the caller refuses explicitly; sports without a table keep the legacy flat map |
| apps/smart-form/test/form-utils.test.ts | Catalog coverage, sport-awareness, newly mapped ids, explicit refusal tests |
| apps/smart-form/e2e/phase-one.spec.ts | NHL Shots on Goal row-asserted case; corrects the shared submit helper's success assertion to the current `Saved as Track Only` heading |
| docs/06_status/proof/WORK-2026102501/ | Proof files |

## SHA Binding

Merge SHA: pending merge
PR: pending
