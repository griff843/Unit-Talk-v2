# UTV2-1180 Diff Summary

## Summary

- Added the three T1 proof suites to the `@unit-talk/api` package test script so package-level verification executes the UTV2-1109, UTV2-1110, and UTV2-1111 proof tests.
- Converted the proof suites away from `describe()` / `it()` wrappers and into `node:test` `test()` calls, matching the repo test-runner contract.
- Captured verification and runtime-health evidence in the UTV2-1180 proof bundle.

## Files Changed

- `apps/api/package.json` - wires the three T1 proof suites into the API package `test` command.
- `apps/api/src/t1-proof-utv2-1109-dual-auth.test.ts` - uses top-level `test()` cases from `node:test`.
- `apps/api/src/t1-proof-utv2-1110-approval-expiration.test.ts` - uses top-level `test()` cases from `node:test`.
- `apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts` - formatting normalized by Prettier while retaining `node:test` semantics.
