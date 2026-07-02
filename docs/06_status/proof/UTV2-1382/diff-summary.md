# UTV2-1382 Diff Summary

Generated at: 2026-07-02T16:11:29.306Z
Issue: UTV2-1382
Tier: T2
Lane type: verification
Branch: griffadavi/utv2-1382-scoring-validation-audit-verify-scores-are-meaningful-after
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1140
Head SHA: 34610aa1dcedd9db7d12f0dbbd773c0360552abc
Merge SHA: 4bbed4935740110135d798ce7ef138c2c4f07d06
Diff base: 4bbed4935740110135d798ce7ef138c2c4f07d06^1
Diff target: 4bbed4935740110135d798ce7ef138c2c4f07d06

## Git Diff Stat
```
.ops/sync/UTV2-1382.yml                            |  10 +
 docs/06_status/lanes/UTV2-1382.json                |  42 ++
 docs/06_status/proof/UTV2-1382/audit-report.md     | 312 ++++++++++++
 docs/06_status/proof/UTV2-1382/diff-summary.md     |  16 +
 .../UTV2-1382/scoring-validation-summary.json      | 303 +++++++++++
 docs/06_status/proof/UTV2-1382/verification.md     |  71 +++
 package.json                                       |   2 +-
 .../audits/utv2-1382-scoring-validation.test.ts    | 135 +++++
 scripts/audits/utv2-1382-scoring-validation.ts     | 551 +++++++++++++++++++++
 9 files changed, 1441 insertions(+), 1 deletion(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1382.yml
A	docs/06_status/lanes/UTV2-1382.json
A	docs/06_status/proof/UTV2-1382/audit-report.md
A	docs/06_status/proof/UTV2-1382/diff-summary.md
A	docs/06_status/proof/UTV2-1382/scoring-validation-summary.json
A	docs/06_status/proof/UTV2-1382/verification.md
M	package.json
A	scripts/audits/utv2-1382-scoring-validation.test.ts
A	scripts/audits/utv2-1382-scoring-validation.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 34610aa1dcedd9db7d12f0dbbd773c0360552abc
Merge SHA: 4bbed4935740110135d798ce7ef138c2c4f07d06

## Narrative

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
| `package.json` | Wires the new test file into the `test:ops` script (`return-review-packet` test_wiring check requirement). |

No production code, domain logic, database schema, or promotion/scoring
behavior was modified in this lane.
