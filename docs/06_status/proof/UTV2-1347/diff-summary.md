# UTV2-1347 Diff Summary

**Merge SHA:** 39cc9e78fdf8d8b9f8257788c42cddb6c678b7ba — PR #1104 merged 2026-06-28

Verification-only lane — no code changes. This lane confirms UTV2-1345's fix: `grading-service.ts` lines 343–378 correctly capture per-pick exception messages in catch blocks, aggregate them as `errorDetails`, and write them to `system_runs.details.errors` via `completeRun()`. Unit tests pass 61/61 including test #37 ("runGradingPass writes grading.run row with failed count when errors occur"). Live DB query blocked by pre-existing Supabase statement timeout on system_runs table.
