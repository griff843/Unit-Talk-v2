# UTV2-1125 Runtime Verification

Generated at: 2026-05-30T03:22:00Z
Issue: UTV2-1125
Tier: T1
Branch: codex/utv2-1125-init-342-edge-price-freshness-enforcement
Head SHA at proof generation: 1603f796824a73bf944bf9a5d3fde947dd1be672
Implementation SHA: 9d3f521ce08e8006bbd99267534c24f24cda8eeb
Merge SHA: N/A pre-merge

## Summary

UTV2-1125 adds fail-closed edge-price freshness enforcement before edge validation uses CLV significance. The domain evaluator rejects missing price snapshot timestamps, missing price provider keys, and stale price snapshots. Decision records now carry immutable replay-visible edge-price freshness evidence.

## Evidence

- `packages/domain/src/stale-data.ts` adds `evaluateEdgePriceFreshness` over the existing freshness window contract.
- `packages/domain/src/edge-validation/edge-validator.ts` evaluates edge-price freshness before CLV analysis when sample size is sufficient.
- `packages/domain/src/models/decision-record.ts` freezes and verifies edge-price freshness evidence for replay.
- `packages/domain/src/edge-validation/edge-validation.test.ts` covers fresh boundary acceptance, missing freshness failure, stale snapshot rejection, and frozen replay evidence.
- `docs/06_status/proof/UTV2-1125/evidence.json` records the T1 static and runtime proof bundle.

## Verification

- `npx tsx --test packages/domain/src/edge-validation/edge-validation.test.ts`: PASS, 22 tests, 0 failures.
- `pnpm type-check`: PASS.
- `pnpm test`: PASS.
- `pnpm test:db`: PASS, 7 tests, 0 failures against Supabase project `zfzdnfwdarxucxtaojxm`.
- `pnpm verify`: PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, changed files 7, rules matched none.
- `pnpm ops:proof-check UTV2-1125 --json`: PASS.

Runtime proof note: this is a domain-only enforcement lane with no schema or DB-write path changes. T1 live DB smoke still passed, and root verify also executed the shared T1 live proof suite. Existing stranded `awaiting_approval` rows were reported by known diagnostics and were not mutated by this lane.

## SHA Binding

Proof generation head SHA: 1603f796824a73bf944bf9a5d3fde947dd1be672
Implementation SHA: 9d3f521ce08e8006bbd99267534c24f24cda8eeb
Merge SHA: N/A pre-merge
