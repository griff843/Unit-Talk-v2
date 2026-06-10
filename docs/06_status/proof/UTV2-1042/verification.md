# UTV2-1042 Verification

## Verification

Issue: UTV2-1042
Tier: T2
Branch: codex/utv2-1042-syndicate-ready-edge-certification
Date: 2026-06-10
Supabase project: zfzdnfwdarxucxtaojxm
Merge SHA: (SHA-bound post-merge by post-merge-lane-close.yml)

## Commands run

- `pnpm type-check`: PASS
- `pnpm test`: PASS
- `pnpm verify`: PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS (no rules matched)
- Live DB queries executed: YES — see `evidence-evaluation.md`

## pnpm test:db output

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 113400.392168
```

## Data gate status (v11 monitor, 2026-06-10T05:38Z)

- `dispatch_gate=OPEN`
- `pick_candidates_post_cutover`: 2,964 (Gate 1 MET)
- `closing_over_odds_post_cutover`: 2,606 (Gate 2 MET)
- `clv_join_count`: 126 (Gate 3 MET)

## Empirical verdict

**`INSUFFICIENT_DATA`**

| Metric | Result | Threshold | Status |
|--------|--------|-----------|--------|
| Settled picks on CLV join path | 0 | ≥50 (DEVELOPING) | FAIL |
| CLV direction | not computable | positive median | — |
| ROI | not computable | positive | — |
| Brier score | not computable | — | — |

Root cause: 100/126 CLV-path picks are in `awaiting_approval` (P7A governance brake, working as designed).
601 post-cutover picks are settled but have no CLV join path (no closing_over_odds on their market_universe rows).

## Certification claims

- P3 certification: **NOT granted**
- DEVELOPING label: **NOT earned** (0 settled CLV-path picks vs 50 required)
- STRONG / ELITE / syndicate-ready: **NOT claimed**
- CLV certified: **NO**
- Real-money-safe: **NOT asserted**
