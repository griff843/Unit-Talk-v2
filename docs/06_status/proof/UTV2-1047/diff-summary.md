## Summary

UTV2-1047: Wired automatic PR risk packet generation into the existing return-review-packet CI workflow. Added `PRRiskPacket` interface and `buildRiskPacket` function to `scripts/ops/pr-review-packet.ts` that computes a risk signal (LOW/MEDIUM/HIGH/BLOCKED) from scope bleed count, Tier C path touches, missing proof, R-level status, sync metadata, and CI failure count. The workflow now passes `--risk-output artifacts/pr-risk-packet.json` and uploads both packets as build artifacts.

## Evidence

**Changed files:**
- `scripts/ops/pr-review-packet.ts`: +143 lines — `PRRiskPacket` type, `buildRiskPacket()`, wired into `generatePRReviewPacket()` return value, `--risk-output` CLI flag handling
- `.github/workflows/return-review-packet.yml`: +5 lines — passes `--risk-output` flag, uploads `pr-risk-packet.json` alongside existing artifact

**Verification:**
- `pnpm type-check` — PASS
- `pnpm test` (all tests) — PASS
- R-level check: PASS (no R-level artifacts required — CI + script only)
- `pnpm verify` — PASS

## Verification

- [x] `pnpm type-check` — PASS
- [x] `pnpm test` — PASS
- [x] `pnpm verify` — PASS
- [x] R-level compliance — PASS (no runtime data path modified)
- [x] Tier label `tier:T2` on PR
- [x] Closes UTV2-1047

## Merge SHA

a176e3221da253a20ed3360e9f4300423a0c3524
