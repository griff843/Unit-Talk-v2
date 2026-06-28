# UTV2-1347 Diff Summary

Verification-only lane — no code changes. This lane confirms UTV2-1345's fix: `grading-service.ts` lines 343–378 correctly capture per-pick exception messages in catch blocks, aggregate them as `errorDetails`, and write them to `system_runs.details.errors` via `completeRun()`. Unit tests pass 61/61 including test #37 ("runGradingPass writes grading.run row with failed count when errors occur"). Live DB query blocked by pre-existing Supabase statement timeout on system_runs table.
