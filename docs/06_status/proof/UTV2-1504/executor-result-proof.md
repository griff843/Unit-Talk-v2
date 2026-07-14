# PROOF: UTV2-1504
MERGE_SHA: 909067cc6221f8430d18cfb1b015dbb1ece923ae

ASSERTIONS:
- [x] Identify when/where cap was exceeded — PARTIAL/INCONCLUSIVE (no historical dispatch/preflight artifact retained in the repository to attribute the specific event; documented as an evidence-retention gap, not asserted as "no incident")
- [x] Determine whether status ledger, enforcement, or reporting was wrong — PASS (current enforcement verified correct: base 6/2/4 cap active, trial governor expired 2026-06-26 and correctly reverted, admission checks reject over-cap starts)
- [x] Recommend prevention — PASS (recommends a durable, immutable dispatch decision record: timestamp, active counts, effective limits, refusal code)
- [x] No policy change unless PM approves — PASS (no configuration, cap value, or orchestration code changed)
- [x] No product code changes — PASS (docs-only diff)

EVIDENCE:
```text
pnpm verify
  PASS — full repository gate completed, including static checks and live-DB smoke tests

npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS — no R-level artifacts required for this diff

npx tsx --test scripts/ops/concurrency-simulation.test.ts
  23/23 tests passed, including rejection of a 7th lane after trial expiry

pnpm ops:execution-state -- --json (audit timestamp 2026-07-14T04:50:06Z)
  active lanes: 1 (UTV2-1504), codex 1/4, claude 0/2, no blocked lanes, no merge-risk findings
```

NOTES:
Docs-only audit lane (docs/06_status/CONCURRENCY_CAP_C4_INCIDENT_AUDIT.md), no
governance config, lane manifest, or orchestration code touched.
