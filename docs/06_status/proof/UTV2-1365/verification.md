# UTV2-1365 Verification Log

**Issue:** UTV2-1365  
**Title:** Deploy current main for E2E gates  
**Tier:** T1  
**Branch:** `claude/utv2-1365-deploy-verify-prod-sha`  
**Verification date:** 2026-06-29  

## Summary

Deployed main SHA `3ea31d87f0a83db3a49b4468140cc4ed83bb0055` to production via GitHub Actions `Deploy` workflow. All 9 jobs passed. Candidate quality gates (UTV2-1364) are now live.

## Pre-Deploy State

| Field | Value |
|-------|-------|
| Previous deployed SHA | `d313ad95` |
| Main HEAD SHA | `3ea31d87f0a83db3a49b4468140cc4ed83bb0055` |
| SHA gap | Yes — 8 commits behind (UTV2-1364 gates not live) |

## Deploy Execution

**Workflow run:** [#28404945789](https://github.com/griff843/Unit-Talk-v2/actions/runs/28404945789)  
**Triggered:** 2026-06-29T21:49:17Z via `workflow_dispatch` on `main`  
**Completed:** 2026-06-29T21:58:49Z  
**Deployed SHA:** `3ea31d87f0a83db3a49b4468140cc4ed83bb0055`

### Job results

| Job | Conclusion | Duration |
|-----|-----------|----------|
| verify | success | 3m5s |
| rollback-dry-run | success | 8s |
| build (api) | success | ~1m55s |
| build (worker) | success | ~2m5s |
| build (ingestor) | success | ~1m28s |
| build (discord-bot) | success | ~1m57s |
| Canary deploy | success | ~2m39s |
| Promote production | success | ~59s |
| Post-deploy functional smoke | success | ~20s |

**All jobs: PASS**

## Post-Deploy Verification

- Deployed SHA `3ea31d87f0a83db3a49b4468140cc4ed83bb0055` matches main HEAD: **YES**
- Canary health check passed: **YES** (canary job completed successfully)
- Post-deploy functional smoke: **PASS**
- UTV2-1364 candidate quality gates now live: **YES**

## pnpm verify

Run as `pnpm verify:static` in the deploy workflow verify job — **PASS**.

```
pnpm verify

(lint) — no errors
(type-check) — clean
(build) — clean

# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## R-level check

No source files changed in this lane. Deploy-only operation. R-level: no rules triggered.

## pnpm test:db

```
pnpm test:db

# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
