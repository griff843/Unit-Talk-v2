# UTV2-1339 Diff Summary

**Issue:** UTV2-1339 — Terminal proof criteria for Pipeline Finalization milestones  
**Tier:** T2  
**Branch:** claude/utv2-1339-terminal-proof-criteria

## Files Changed

| File | Change | Notes |
|------|--------|-------|
| `docs/05_operations/PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md` | CREATED | Terminal PASS/PARTIAL/BLOCKED criteria for M1–M5; milestone summary table; lane obligation section |

## Summary of Changes

Documentation-only lane. No code, schema, or runtime changes.

Defines exact terminal verdict criteria for all five pipeline finalization milestones:

- **M1 (DB Finalization):** PARTIAL — spec done (UTV2-1328), execution plan pending (UTV2-1341)
- **M2 (Model-Driven Promotion):** PARTIAL — implementation done (UTV2-1327), provenance monitor pending (UTV2-1342)
- **M3 (Grading Runtime Proof):** PARTIAL — heartbeat active, failure rate elevated (34.8% vs 1.46% baseline), investigation open (UTV2-1343)
- **M4 (Evidence-Flow Internal Pick):** BLOCKED — this document must merge first; UTV2-1343 must close; UTV2-1331 must be done
- **M5 (DevOps Finalization):** PARTIAL — component monitoring confirmed, grading staleness alert absent (UTV2-1344)

Adds "inflation guard" (evidence older than 30 days cannot satisfy PASS) and "lane obligation" (all lanes must declare milestone impact in PR body).

## Milestone Impact

- **Milestone:** M4 — Evidence-Flow Internal Pick
- **Verdict before:** BLOCKED
- **Verdict after:** Still BLOCKED — but this document defines the prerequisite that must merge before BLOCKED → PARTIAL transition can occur
- **Criterion satisfied:** Criterion 2 (terminal criteria accepted) will be satisfied upon merge of this PR
- **Remaining gaps:** Criteria 3, 4, 5, 6 (UTV2-1343 must close, UTV2-1331 must be done, live flow must be proven, governance brake confirmed)
