# UTV2-1449 Verification Log

**Issue:** UTV2-1449 — Product-truth scoreboard in ops:brief (model-certification thresholds)
**Tier:** T3
**Branch:** claude/utv2-1449-product-truth-scoreboard
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1148
**Merge SHA:** bcc11bb1f7ce3f4e36dccbc9b26e83827406f36b

## Verification

| Command | Status | Evidence |
|---------|--------|---------|
| `pnpm type-check` | PASS | run 2026-07-04 on main at merge SHA `bcc11bb1` — `tsc -b tsconfig.json` clean, zero errors |
| `pnpm exec tsx --test scripts/product-truth-scoreboard.test.ts` | PASS | run 2026-07-04 on main — TAP: `# tests 5` / `# pass 5` / `# fail 0` / `# skipped 0` |
| `pnpm verify` (branch CI) | PASS | required `verify` context green on PR head `483d85b1` (identical tree to squash merge `bcc11bb1`); all four required contexts (verify, Executor Result Validation, Merge Gate, P0 Protocol) green at merge |
| `scripts/ci/r-level-check.ts` | PASS | run 2026-07-04 with `--base bcc11bb1^1 --head bcc11bb1` — Verdict: PASS, 6 changed files, no R-level artifacts required |

## Runtime evidence (live DB queries)

`pnpm ops:product-truth-scoreboard` executed 2026-07-04 on main at merge SHA `bcc11bb1` against live Supabase (project `zfzdnfwdarxucxtaojxm`). The script queries `settlement_records` joined to `picks` over a 30-day window with fixture exclusion. Live output with real row_counts:

```
Settled (30d, non-fixture): 1136 (14157 fixture rows excluded)
CLV coverage: 89.08%
Edge source: 0% explicit, 85.92% market-backed, 14.08% confidence-fallback
Kelly sizing populated: 86%
DEVELOPING: 976/50 (MET)
STRONG: 976/200 (MET)
```

Both model-certification thresholds are MET on live data: 976 market-backed settled picks against the DEVELOPING (50) and STRONG (200) thresholds. Queries run through the shipped `computeProductTruthScoreboard()` path — the same code `ops:brief` now calls via `buildProductTruthSection`.

## What This Lane Delivers

- `scripts/product-truth-scoreboard.ts` — computes settled-pick counts, CLV coverage, edge-source quality split (explicit / market-backed / confidence-fallback), Kelly-sizing coverage, and DEVELOPING/STRONG certification-threshold status from live settlement data, with fixture exclusion.
- `scripts/product-truth-scoreboard.test.ts` — 5 unit tests over classification and threshold logic.
- `scripts/ops-brief.ts` — new product-truth section in `ops:brief`.
- `package.json` — `ops:product-truth-scoreboard` script entry.
