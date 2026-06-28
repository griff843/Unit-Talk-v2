# UTV2-1342 Diff Summary

Generated at: 2026-06-27T21:42:30-04:00  
Issue: UTV2-1342  
Tier: T2  
Lane type: verification/docs  
Branch: codex/utv2-1342-model-provenance-monitor  
PR URL: blocked by branch-scope decision  
Head SHA: pending final amend  
Merge SHA: pending

## Summary

UTV2-1342 is a measurement-only follow-up to UTV2-1327. This lane defines the read-only model input provenance monitor that reports:

- fallback rate for new promotion decisions
- model-driven promotion-score percentage for new promotion decisions
- edge/provider coverage breakdowns using existing promotion history snapshots

No runtime code, migrations, schema files, app wiring, or DB writes were changed.

## Files Changed

| File | Purpose |
|---|---|
| `docs/06_status/proof/UTV2-1342/provenance-monitor-spec.md` | Defines the monitor data source, metric formulas, SQL sketch, JSON output contract, alert guidance, and non-goals |
| `docs/06_status/proof/UTV2-1342/diff-summary.md` | Summarizes the lane diff and scope |
| `docs/06_status/proof/UTV2-1342/verification.md` | Records verification commands and issue-specific evidence |

## Source Evidence

Existing runtime fields support the monitor without a new implementation change:

- `apps/api/src/promotion-service.ts` persists `scoreInputs.edgeSourceQuality`, `edgeSource`, `edgeMethod`, `providerCoverageState`, `edgeFallbackReason`, `uniquenessFallbackReason`, and `uniquenessInputs` into promotion decision snapshots.
- `packages/contracts/src/promotion.ts` defines `PromotionDecisionSnapshot` and the typed score-input accessor.
- `apps/api/src/promotion-edge-integration.test.ts` includes UTV2-1327 tests proving promotion-time enrichment for edge/readiness inputs.

## Scope Check

Allowed file scope:

- `docs/06_status/proof/UTV2-1342/diff-summary.md`
- `docs/06_status/proof/UTV2-1342/provenance-monitor-spec.md`
- `docs/06_status/proof/UTV2-1342/verification.md`

This lane's authored proof scope matches the allowed list. The branch diff against `origin/main` also contains pre-existing lane metadata files outside the packet's allowed list:

- `.ops/sync/UTV2-1342.yml`
- `docs/06_status/lanes/UTV2-1342.json`

PR creation is blocked until PM/orchestrator confirms whether those metadata files should remain in the PR or the branch should be reshaped to contain only the allowed proof files.

## Risk

Low. This is a docs/proof-only monitor definition. The spec is deliberately report-only and does not alter promotion scoring, lifecycle state, approval state, distribution, or database schema.
