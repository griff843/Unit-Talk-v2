## Runtime Verification — UTV2-1047

**Issue:** Auto-generate PR review and risk packets for T1/T2 PRs
**Tier:** T2
**Lane type:** governance

## Scope

Changes are limited to:
- `scripts/ops/pr-review-packet.ts` (new `PRRiskPacket` type + `buildRiskPacket` function)
- `.github/workflows/return-review-packet.yml` (adds `--risk-output` flag + artifact upload)

No runtime submission/scoring code modified. No database schema changes. No worker logic touched.

## Verification

- [x] `pnpm type-check` — PASS
- [x] `pnpm test` — PASS
- [x] `pnpm verify` — PASS
- [x] R-level check — PASS (CI + script only, no R-level paths touched)
- [x] T2 merge authority: orchestrator on green CI
