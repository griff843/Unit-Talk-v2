# UTV2-1382 Diff Summary

Validation-only lane — no scoring logic, no app/package code, no schema
changes. All changes are lane apparatus, a new read-only audit script, its
test, and the audit output/report.

| File | Change |
|---|---|
| `scripts/audits/utv2-1382-scoring-validation.ts` | New read-only reporting script. Queries `public.picks` over a rolling window, excludes non-production sources and test/proof fixture rows (`metadata.testRun`, `metadata.proof_issue`, `metadata.proof_fixture_id`, `selection` containing `"proof"`), then computes band/edgeSourceQuality/Kelly/fallback-reason/suppress-reason distributions, a stale/postgame/SUPPRESS-band leakage check, per-source scoring health, and a fixture-saturation-by-source check. Classification logic (`classifyEdgeSourceQuality`, `classifyFallbackReason`) mirrors the existing production logic in `apps/api/src/promotion-service.ts` / `scripts/edge-fallback-report/run-edge-fallback-report.ts` rather than importing it, matching the established measurement-tool pattern. Writes `scoring-validation-summary.json` to `docs/06_status/proof/UTV2-1382/`. |
| `scripts/audits/utv2-1382-scoring-validation.test.ts` | Unit tests using injected fixture rows (no live DB): fixture-exclusion coverage (testRun + all three legacy proof markers + non-production source), edgeSourceQuality/band/fallback-reason classification correctness, fixture-saturation-by-source verdict gating, and SUPPRESS-band-but-promoted leakage detection. |
| `docs/06_status/proof/UTV2-1382/audit-report.md` | The audit narrative: distributions, verdict (PARTIAL), and 4 finding packets with impact/affected paths/recommended child lane/proof required/PM-gate call. |
| `docs/06_status/proof/UTV2-1382/scoring-validation-summary.json` | Raw JSON output from the live-DB run this report is based on (30-day window, generated 2026-07-02). |
| `docs/06_status/lanes/UTV2-1382.json`, `.ops/sync/UTV2-1382.yml` | Standard lane manifest + sync metadata. |

No production code, domain logic, database schema, or promotion/scoring
behavior was modified in this lane.
