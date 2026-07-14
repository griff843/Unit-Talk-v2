# UTV2-1411 Diff Summary

Head SHA: 88da8b00601f94d399d5cf52fd177163556a0b1b
Merge SHA: 4f216c8619fb05b4ca9ece1e97ebff4d92d4fff5

## Scope

This is a read-only live-DB verification lane per the issue's own instructions. No
runtime, schema, contract, domain, or API code was changed. The only files in this
diff are lane metadata and proof artifacts.

## Finding (live query, 2026-07-14, last 30 days, excluding `t1-proof`/canary test-fixture
sources and rows tagged `metadata.testRun`)

Real production picks in the window: 13,095 (down from the naive full-table count
after excluding fixture contamination — 2,799 of the originally-queried rows were
`source = 't1-proof'` test fixtures with no `domainAnalysis` at all, not production
data).

| Edge state | Count | % |
| --- | --- | --- |
| Real edge (domainAnalysis present, no fallback) | 8,395 | 64.1% |
| Fallback: `no-confidence` | 4,698 | 35.9% |
| Fallback: no domainAnalysis (invalid/missing odds) | 2 | 0.02% |

**The residual fallback rate today is ~36%, materially better than the audit's cited
55-60% figure** — the UTV2-1379/1380/1394/1395/1397 lineage (closed 2026-06-30 to
2026-07-02) already closed a large part of the gap.

**The remaining ~36% fallback is NOT explained by UTV2-1398 (market-family classifier
gap).** `analysis.fallbackReason = 'no-confidence'` is set in
`apps/api/src/domain-analysis-service.ts:133` purely because the pick's `confidence`
field is absent/out-of-range at submission time — this check runs before and
independently of any market-family classification, which only affects
`MARKET_FAMILY_PROMOTION_MODIFIERS` weighting downstream, not whether `domainAnalysis`
falls back in the first place. UTV2-1398 is still unimplemented (Backlog) and its fix
would not move this number.

**Root cause, by source:**

| Source | Real edge | `no-confidence` fallback |
| --- | --- | --- |
| system-pick-scanner | 3,292 | 1,265 (28% of scanner picks) |
| api | 2,691 | 1,881 (41% of api picks) |
| model-driven | 802 | 627 (44%) |
| alert-agent | 814 | 631 (44%) |
| smart-form | 336 | 294 (47%) |
| board-construction | 460 | 0 |

The fallback is concentrated in automated/system-generated sources
(system-pick-scanner, api, model-driven, alert-agent) — these are not human-capper
submissions and structurally have no capper-provided confidence value to supply.
Per the code's own documented intent (`domain-analysis-service.ts:62-68`), this is
the *correct* classification for that case, not a defect: a real fix requires those
sources to supply a model-computed edge/confidence signal, which is the separate,
already-tracked shadow-model / stat-projection live-scoring workstream (UTV2-1430,
UTV2-1509) — not a narrowly-scoped patch within this issue's declared scope.

## Conclusion / stop condition

Per the issue's stop conditions: this is not "resolved by UTV2-1398" (1398 doesn't
touch this fallback path at all) and it does not warrant filing a new narrowly-scoped
fix issue either, because there is no narrow fix available — the residual is expected
behavior for automated sources lacking a capper confidence input, and the real
remediation path (model-computed edge) is already tracked elsewhere (UTV2-1430,
UTV2-1509). Recommend closing UTV2-1411 with this finding: gap substantially reduced
by prior fixes (55-60% down to ~36%), residual is by-design for automated sources,
UTV2-1398 does not apply, no new issue needed.

## Safety assessment

No production behavior changes. No database writes, migrations, runtime
configuration changes, or Discord target changes were made. All queries were
read-only `SELECT` statements against `public.picks`.
