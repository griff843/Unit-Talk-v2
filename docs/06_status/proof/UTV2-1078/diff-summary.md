# Diff Summary — UTV2-1078

**Merge SHA:** `974efc6a3c176bfcf83997a3e89748d9a61f054b`

## Summary

Fix: `normalizeFileScopePath` in `scripts/ops/shared.ts` now accepts an `allowMissing` option. When set, the function returns the path as-is if the file doesn't exist instead of throwing `ENOENT`. This prevents `ops:lane-start` from crashing when `expected_proof_paths` reference files that haven't been created yet at lane start time.

## Issue
Allow non-existent proof paths in `normalizeFileScopePath` so `ops:lane-start` does not crash when `expected_proof_paths` reference files that don't exist yet at lane creation time.

## Files Changed
- `scripts/ops/shared.ts` — updated `normalizeFileScopePath` to skip normalization for non-existent files when `allowMissing` option is set
- `scripts/ops/shared.test.ts` — added test coverage for the new `allowMissing` behavior
- `docs/06_status/lanes/UTV2-1078.json` — lane manifest

## Root Cause
`normalizeFileScopePath` called `fs.realpathSync` unconditionally. If a path in `expected_proof_paths` didn't exist yet, it threw `ENOENT`, crashing `ops:lane-start` before the worktree was set up.

## Fix
Added `allowMissing?: boolean` option to `normalizeFileScopePath`. When set, returns the path as-is if the file doesn't exist instead of throwing.

## Test Results
All tests pass. No scope changes beyond `scripts/ops/shared.ts` and its test file.
