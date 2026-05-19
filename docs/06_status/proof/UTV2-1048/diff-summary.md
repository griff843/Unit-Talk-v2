## Summary

UTV2-1048: Promoted lane-governor into automatic dispatch preflight artifact policy. Updated `docs/governance/LANE_CONCURRENCY_POLICY.md` to codify the dispatch preflight artifact as the authoritative enforcement surface — required contents, refusal conditions, and demotion of manual `lane-governor` to investigation-only.

## Evidence

**Changed file:** `docs/governance/LANE_CONCURRENCY_POLICY.md`

Policy changes made:
- Dispatch preflight artifact now required for every lane attempt
- Artifact must record: active lane count, executor limits, forbidden combos, file-scope overlap, Tier C exposure, dependency blockers, final dispatch decision
- `ops:lane:start` must refuse when deterministic blockers are present
- Manual `lane-governor` prompt demoted to investigation aid only
- Pre-dispatch gate list for ≥4-lane waves updated (2 → 4 gates)

`pnpm test` PASS (all 22 preflight tests), `pnpm type-check` PASS, `pnpm verify` PASS.
R-level check: PASS (no R-level artifacts required — governance doc only).

## Verification

- [x] `pnpm type-check` — PASS
- [x] `pnpm test` (22 preflight tests) — PASS
- [x] `pnpm verify` — PASS
- [x] R-level compliance — PASS (docs-only change)
- [x] Tier label `tier:T2` on PR #796
- [x] Governance doc change only — no runtime code modified

## Merge SHA

30a21254b461a1f193f8b0f9d63b037efbc50a34
