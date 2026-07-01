# UTV2-1395 Diff Summary

## Summary

Small follow-on fix split out of the domainAnalysis/confidence-delta fallback investigation, moved to a `delivery-ui` lane because it touches `apps/smart-form/**`.

- `apps/smart-form/lib/form-utils.ts`: `buildSubmissionPayload()` now caps the `capperConviction`→`confidence` mapping at 0.99 for conviction=10 (was exactly 1.0, which failed a strict `confidence < 1` guard downstream and silently skipped domainAnalysis entirely for max-conviction picks). Adds `metadata.confidenceSource: 'capper-conviction'` for explicit provenance. The displayed/stored `capperConviction` value is unchanged (still 10 for max conviction).
- `apps/smart-form/CLAUDE.md`: corrected a stale claim that the form lacks a confidence field — `capperConviction` has mapped to submission `confidence` since UTV2-255 (March 2026).
- `apps/smart-form/test/form-utils.test.ts`: new test asserting conviction=10 maps to confidence=0.99 (not 1.0), `capperConviction` metadata stays 10, and `confidenceSource` is set.

## No UI/visual change

This is a pure internal computation fix — no component, layout, or visible form behavior changed (the conviction input itself, its range, and its display are all unchanged). Screenshots are not applicable; there is nothing new to visually verify.
