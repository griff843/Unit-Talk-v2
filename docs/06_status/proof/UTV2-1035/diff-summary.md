# UTV2-1035 Diff Summary

## Summary

**Issue:** UTV2-1035 — Board truth reset: reclassify mechanism-only Done issues  
**Branch:** `claude/utv2-1035-board-truth-reset`  
**Tier:** T2 (governance)  
**Executor:** Claude  

## What Changed

This is a governance-only lane. No production code was modified. The deliverable is the board-summary document and Linear comments that establish honest classification of Done issues in the UTV2-980 project.

## Files Created

| File | Purpose |
|------|---------|
| `docs/06_status/proof/UTV2-1035/board-summary.md` | Classification table for all 43 Done issues; risk register; milestone truth status |
| `docs/06_status/proof/UTV2-1035/diff-summary.md` | This file |
| `docs/06_status/proof/UTV2-1035/verification.md` | pnpm verify:quick pass evidence |
| `.ops/sync/UTV2-1035.yml` | Lane sync file (placeholder, created at lane-start) |

## Key Findings

- 43 Done issues classified across 5 categories
- 5 issues have final acceptance proven with live-DB T1 evidence (UTV2-985, UTV2-986, UTV2-993, UTV2-995, UTV2-996)
- 2 issues have sandbox/static proof only: UTV2-981 (Windows sandbox, services DOWN at capture) and UTV2-992 (spawn EPERM, no Hetzner calls made)
- 2 issues need re-proof: UTV2-994 (no proof directory exists) and UTV2-1000 (explicit INSUFFICIENT_DATA verdict, 5 of 50 minimum real-edge picks)
- M7 (72h Production Burn-In) has zero issues assigned and has never been run; its "100%" Linear progress is misleading
- M8 is time-gated; real-edge-backed settled picks are 5 of 50 minimum required

## Merge SHA

_Merge SHA: (to be set at merge)_
