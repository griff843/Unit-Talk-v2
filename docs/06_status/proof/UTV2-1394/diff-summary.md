# UTV2-1394 Diff Summary

## Summary

Re-scoped from an investigation into a domainAnalysis write/persistence gap to a fix for measurement-tool contamination (see `docs/06_status/proof/UTV2-1379/verification.md` E16 for the full investigation).

- `scripts/edge-fallback-report/run-edge-fallback-report.ts`: `--production-only` mode now also excludes rows tagged `metadata.testRun` (T1 `pnpm test:db` proof fixtures written under real production `source` values, mostly `smart-form`), alongside the existing source-based `NON_PRODUCTION_SOURCES` exclusion. Added `excluded_non_production_source_count` and `excluded_test_fixture_count` to the summary output for transparency. Non-`--production-only` runs are unaffected — testRun rows are still included and separately visible when not filtering.
- `scripts/edge-fallback-report/run-edge-fallback-report.test.ts`: two new tests — testRun exclusion under `--production-only`, and confirmation that testRun rows are NOT silently dropped outside `--production-only` mode.
- `docs/06_status/proof/UTV2-1379/evidence.json` + `verification.md`: corrected 7d/14d/90d re-measurement with the fixed filter, plus a live post-deploy-only spot check confirming zero write-path gap once the UTV2-1379 fix is actually live. UTV2-1379 is unblocked.

## No write-path change

No production code (`apps/api/**`, `packages/contracts/**`) is touched. This is a measurement-tool-only fix — confirmed via live-DB investigation that no active domainAnalysis write/persistence bug exists.

## Follow-up

UTV2-1396 (new, backlog) — the underlying test-fixture-pollutes-production-source-metrics hygiene gap, for other source-keyed tools/dashboards potentially exposed to the same contamination pattern.
