# UTV2-1549 Diff Summary

Issue: UTV2-1549  
Tier: T2  
Lane type: runtime  
Branch: `codex/utv2-1549-pilot-r1-runtime-truth-refresh`  
Merge SHA: `ab1f02c33fe5f2aca10c582df8cd1c037894b4dc` (PR #1235)

## Changes

- `runtime-health.json` records the read-only live Supabase and GitHub deployment observations captured at `2026-07-16T05:10:24.185Z`.
- `readiness-score.json` refreshes the existing readiness schema with those observations and retains an honest `RED` verdict.
- `verification.md` maps the issue acceptance criteria to evidence and records verification commands.

## Outcome

The ingestor has not recovered: the latest `ingestor.cycle`, `provider_offer_history`, and `game_results` evidence all remain on June 30. The worker's latest heartbeat succeeded 82 minutes before observation, but the canonical queue classification contains one true delivery failure. Production deploy `8deccace` is 285 commits behind main `1e2d4af5`. Fresh API settlements continue, but they do not establish SGO ingestion or grading recovery.

No production rows, runtime processes, deployments, or configuration were mutated.
