# UTV2-1217 Diff Summary

**Lane:** UTV2-1217 — CLV/Edge Evidence Collection
**Tier:** T2 | **Executor:** claude/utv2-1217
**Completed:** 2026-06-06

## What this lane produced

Evidence collection pass against live Supabase DB (project zfzdnfwdarxucxtaojxm).
No source files were modified.

**Files created:**
- `docs/06_status/proof/UTV2-1217/evidence.json` — machine-readable evidence bundle
- `docs/06_status/proof/UTV2-1217/verification.md` — full SQL queries and row-count results
- `docs/06_status/proof/UTV2-1217/diff-summary.md` — this file

## Key finding

No statistical CLV/edge claim can be made from current DB state:

1. `model_registry.artifact_sha` is NULL for all champion models — no Wave-5 SHA to key off
2. All post-Wave-5 picks (June 2026+) have `sport_id=NULL` — synthetic smoke-test corpus only
3. `domainAnalysis.version` uniform at `v1.0.0` across all picks — no version discriminator

The Wave-5 code path is merged and wired. Production picks have not yet accumulated under a new registered model artifact. This evidence bundle establishes the baseline; a follow-up collection pass is needed once real picks flow through the stat-model path.

## Constitutional compliance

SGO not activated. P3 not advanced. P5 not unfrozen. No edge/CLV/ROI claim made.
