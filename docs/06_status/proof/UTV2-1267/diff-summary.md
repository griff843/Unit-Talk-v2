# UTV2-1267 Diff Summary

## Summary

SGO provider-truth audit: classify 172 backfilled closing_for_clv rows as PASS/WARN/FAIL.

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/scripts/sgo-provider-truth-audit.ts` | New audit script (172-row classifier) |
| `docs/06_status/proof/UTV2-1267/audit-results.json` | Full audit output with 5 reporting buckets |
| `docs/06_status/proof/UTV2-1267/verification.md` | Proof document |
| `docs/06_status/proof/UTV2-1267/diff-summary.md` | This file |
| `docs/06_status/lanes/UTV2-1267.json` | Lane manifest (lane_type corrected to runtime) |

## Key Changes

- **Audit script**: fetches all backfill rows via `pick_offer_snapshots` + joins `settlement_records.payload.clv` for closing odds; applies Phase 1 DB signals and Phase 2 known verdicts from 31-pick SGO MCP sample
- **Result**: 172 rows — PASS=159 (92.4%), WARN=7 (4.1%), FAIL=6 (3.5%)
- **No runtime changes**: script is read-only proof tooling; no production behavior modified

## Evidence

`docs/06_status/proof/UTV2-1267/audit-results.json` — 172 rows with full classification detail, 5 reporting buckets, posture statement, and guardrails.
