# UTV2-1060 Diff Summary

Merge SHA: (to be set post-merge)

## Summary

**Issue:** UTV2-1060 — Reassess stale required-check pollution  
**Branch:** `claude/utv2-1060-stale-check-pollution`  
**Tier:** T2 (governance)  
**Executor:** Claude  

## Root Cause

The Proof Auditor Gate used `git diff --name-only` without filtering out deleted files. When a PR is based on a `main` that had proof directories deleted in earlier lane-close commits (e.g. `.ops/sync/UTV2-XXXX.yml` removal), those deleted paths appeared in the diff. The gate then attempted to audit directories that don't exist at PR HEAD, causing spurious failures.

## Fix

Changed `proof-auditor-gate.yml` line 70: added `--diff-filter=ACM` to the `git diff` command. This restricts the diff to Added, Copied, and Modified files only, excluding Deleted paths. Closed-lane proof directories that were removed from `main` no longer pollute the gate's directory list.

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/proof-auditor-gate.yml` | Add `--diff-filter=ACM` to `git diff` command |

## Scope Note

Single-line change to a required CI check. No production code modified.
