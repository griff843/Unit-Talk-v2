# PROOF: UTV2-1411
MERGE_SHA: e3e33ec1887d87dc73871913deec191e4ea76d6c

ASSERTIONS:
- [x] Explicit finding: current % of picks on confidence-delta/constant fallback, measured today — PASS (~36% fallback, all `no-confidence`, vs the audit's 55-60%; full per-source breakdown in diff-summary.md)
- [x] Explicit statement of whether the residual gap is fully explained by UTV2-1398 or a distinct gap remains — PASS (NOT explained by UTV2-1398; confirmed by reading `apps/api/src/domain-analysis-service.ts:60-133` — the no-confidence fallback check runs independently of market-family classification)
- [x] If a distinct gap remains, file it narrowly-scoped and linked — N/A per stop-condition analysis: no narrow fix exists (residual is by-design for automated sources lacking capper confidence; real remediation is the already-tracked shadow-model workstream, UTV2-1430/UTV2-1509)
- [x] Do not reopen UTV2-1379 — PASS, not reopened
- [x] Proof required: live query results — PASS (query + result in verification.md)

EVIDENCE:
```text
Live SQL against public.picks (Supabase project zfzdnfwdarxucxtaojxm), 2026-07-14:
  no-fallback-real-edge: 8395 (64.1% of real production picks)
  no-confidence:         4698 (35.9%)
  no-domainAnalysis:     2 (real) + 2799 (t1-proof test fixtures, excluded)

pnpm verify
  PASS — full repository gate completed, including static checks and live-DB smoke tests

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS — no R-level artifacts required for this diff
```

NOTES:
Codex's initial automated pass on this lane produced proof-mechanics content only
(lane bookkeeping, no actual investigation) and did not answer the issue's real
question. The live-DB investigation and finding above were performed directly by
the orchestrator (Claude) using the same read-only Supabase access, then committed
to this branch. No runtime, schema, contract, domain, or API code touched.
