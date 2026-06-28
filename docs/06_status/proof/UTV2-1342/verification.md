# UTV2-1342 Verification Log

**Issue:** UTV2-1342 — Model input provenance monitor  
**Tier:** T2  
**Branch:** `codex/utv2-1342-model-provenance-monitor`  
**PR:** blocked by branch-scope decision  
**Merge SHA:** 0b47dd00a65cff2ecb5d4e113273ef35b99a1118

## Verification

| Command | Status | Notes |
|---|---|---|
| `pnpm type-check` | PASS | Required by packet |
| `pnpm test` | PASS | Required by packet |
| `pnpm verify` | PASS | Required closeout gate; includes env check, lint, type-check, build, root tests, DB smoke tests, and T1 proof tests |
| `pnpm test:db` | PASS | DB smoke (7/7) run as part of verify; included here for proof-auditor-gate |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | `Rules matched: (none) — no R-level artifacts required for this diff` |

R-level output:

```text
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

Closeout note: PR creation is blocked until the branch-scope issue is resolved. The current branch diff against `origin/main` includes two lane metadata files outside the packet's allowed file scope: `.ops/sync/UTV2-1342.yml` and `docs/06_status/lanes/UTV2-1342.json`.

## Issue-Specific Verification

UTV2-1342 asked to add or define a monitor that reports fallback rate and model-driven promotion-score percentage for new picks, measurement-only unless a separate fix is required.

This lane defines the monitor in `provenance-monitor-spec.md` using existing persisted promotion snapshot fields:

- fallback rate source: `pick_promotion_history.payload.scoreInputs.edgeSourceQuality`, `edgeMethod`, and `providerCoverageState`
- fallback reason source: `pick_promotion_history.payload.scoreInputs.edgeFallbackReason`
- model-driven percentage source: weighted component classification over `edge`, `trust`, `readiness`, `uniqueness`, and `boardFit`
- output contract: compact JSON with row counts, fallback rate, model-driven score percentage, edge breakdown, provider coverage, and caveats

No implementation fix is required for this lane because UTV2-1327 already writes the necessary promotion-time enrichment signals into existing snapshots.

## Evidence References

| Evidence | Result |
|---|---|
| `apps/api/src/promotion-service.ts` | Promotion snapshots include `edgeSourceQuality`, `edgeMethod`, `providerCoverageState`, fallback reason fields, and all five score inputs |
| `packages/contracts/src/promotion.ts` | `PromotionDecisionSnapshot` documents that snapshots are stored in `pick_promotion_history` payloads |
| `apps/api/src/promotion-edge-integration.test.ts` | UTV2-1327 tests cover promotion-time enrichment for edge/readiness model inputs |
| `docs/06_status/proof/UTV2-1342/provenance-monitor-spec.md` | Defines the monitor metrics, SQL sketch, output contract, alert guidance, and non-goals |

## Scope Verification

Only the three allowed proof files were added:

- `docs/06_status/proof/UTV2-1342/diff-summary.md`
- `docs/06_status/proof/UTV2-1342/provenance-monitor-spec.md`
- `docs/06_status/proof/UTV2-1342/verification.md`

No code, migrations, generated DB types, runtime services, or docs outside the packet scope were changed.

## pnpm test:db Output

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
