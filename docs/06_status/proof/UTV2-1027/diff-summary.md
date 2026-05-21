# UTV2-1027 Diff Summary

## Summary
- Added `scripts/clv-dashboard.ts`, a read-only operator CLV dashboard export script.
- The script segments settled-pick CLV by overall cohort, sport, band, model version, and CLV source class.
- Output supports Markdown for readiness reports and JSON for command-center ingestion.

## Files Changed
- `scripts/clv-dashboard.ts` — fetches settled records with joined pick metadata, extracts persisted CLV payload fields, classifies Pinnacle/consensus/proxy CLV, computes positive CLV rate, mean/median CLV, stake-based ROI, and CLV/ROI correlation.
- `docs/06_status/proof/UTV2-1027/diff-summary.md` — this implementation summary.
- `docs/06_status/proof/UTV2-1027/verification.md` — verification evidence for the lane.

## Scope Notes
- `apps/command-center/**` was intentionally not touched because it is optional in Linear and outside the lane file lock.
- `apps/api/src/clv-service.ts` was not changed; persisted settlement payloads already include nested `payload.clv.providerKey` and fallback flags needed for source classification.
