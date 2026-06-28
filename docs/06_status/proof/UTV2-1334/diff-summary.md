# Diff Summary — UTV2-1334

**Lane:** UTV2-1334 — Trust Score Corpus Accumulation Plan  
**Tier:** T2  
**Branch:** codex/utv2-1334-trust-score-corpus-accumulation-plan

---

## Changes

This PR is **docs-only**. No source code, no migrations, no config changes.

### Files Added

```
docs/06_status/proof/UTV2-1334/trust-score-accumulation-plan.md
docs/06_status/proof/UTV2-1334/verification.md
docs/06_status/proof/UTV2-1334/diff-summary.md
```

### No Changes To

- `packages/` — no contract, domain, or DB changes
- `apps/` — no application code changes
- `scripts/` — no script changes
- Supabase migrations — none
- CI workflow files — none
- `database.types.ts` — not regenerated (no schema change)

---

## Summary

The plan document (`trust-score-accumulation-plan.md`) provides:

1. A description of the trust score mechanism (`computeClvTrustAdjustment` in
   `apps/api/src/clv-feedback.ts`, `minSampleSize = 10`).
2. Live DB queries showing current state: 1 registered capper (griff843),
   6 settled picks, 0 CLV-computed settlements attributable to griff843.
3. Root cause identification: `metadata.capper` is unset on all 27,038
   smart-form submissions, making per-capper CLV attribution impossible with
   the current data.
4. A concrete accumulation path: fix capper tagging in smart-form, maintain
   ≥3 picks/day from griff843, reach threshold in 2–3 weeks.
5. A monitoring query and trigger definition: when
   `clv_settled_count >= 10`, `computeClvTrustAdjustment` returns a non-null
   adjustment and trust-influenced promotion scoring becomes active.
