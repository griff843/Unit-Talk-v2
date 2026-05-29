# UTV2-1186 Diff Summary

## Summary
- Fixed the live runtime truth proof so smart-form `metadata.playerId` fixtures satisfy the live `picks.player_id` foreign key.
- Reused the service-role database connection for the repository bundle and a typed Supabase client.
- Added a legacy `players` fixture row matching each canonical participant id before submitting the proof pick.

## Files Changed
- `apps/api/src/t1-proof-runtime-truth-spine.test.ts` - creates live `players` rows for proof participants before invoking the real submission and settlement pipeline.

## Notes
- The direct issue-specific command exercises this proof file: `npx tsx --test apps/api/src/t1-proof-runtime-truth-spine.test.ts`.
- Root `pnpm test` and `pnpm verify` pass, but the existing root `test:t1-proof` script does not currently include this file.

## SHA Binding

Merge SHA: 6fb2f3c94a4f93e770098b2f9ea1850c91588152
PR: https://github.com/griff843/Unit-Talk-v2/pull/913
