# UTV2-1397 Diff Summary

Observe-only lane — no scoring logic, no app/package behavior changes, no
DB mutations. Changes are lane apparatus plus a new read-only observation
script, its test, and the report.

| File | Change |
|---|---|
| `scripts/audits/utv2-1397-evidence-flow-observation.ts` | New read-only script. Queries `public.picks` for `alert-agent`, `model-driven`, `smart-form` over a rolling window, excludes test/proof fixture rows (same rule as UTV2-1382's script), and reports per-source: real sample count, excluded fixture count, domainAnalysis-present %, edgeSourceQuality distribution, fallback-reason distribution, promotion-status distribution, and delivery status only when naturally present in metadata (never fabricated). Verdict per source is PASS / PARTIAL / INSUFFICIENT_DATA (a source with 0 real rows is INSUFFICIENT_DATA, never silently PASS/FAIL). Writes `evidence-flow-summary.json`. |
| `scripts/audits/utv2-1397-evidence-flow-observation.test.ts` | Unit tests with injected fixture rows (no live DB): zero-real-rows → INSUFFICIENT_DATA, a real row is counted/classified correctly, majority-confidence-fallback on a populated source → PARTIAL not PASS, delivery_status stays `null` (not fabricated) when absent from metadata. |
| `docs/06_status/proof/UTV2-1397/audit-report.md` | Findings: all three sources return 0 real samples (INSUFFICIENT_DATA); production-wiring research confirms none of the three are part of the deployed topology (`docker-compose.prod.yml`, `deploy.yml` build matrix) — `alert-agent` has a designed 60s poll loop that's never started, `model-driven` has no live producer, `smart-form` is an undeployed human-submission UI. Recommends a PM decision packet (dormant vs. planned vs. dead code) as the next smallest safe step, rather than a standing wait-and-poll lane. |
| `docs/06_status/proof/UTV2-1397/evidence-flow-summary.json` | Raw JSON output from the live-DB run (30-day window, generated 2026-07-02). |
| `docs/06_status/lanes/UTV2-1397.json`, `.ops/sync/UTV2-1397.yml` | Standard lane manifest + sync metadata. |
| `package.json` | Wires the new test file into the `test:ops` script. |

No production code, scoring logic, database schema, or promotion behavior
was modified. No picks were triggered. No synthetic samples were created.
No DB rows were mutated. No delivery was activated.
