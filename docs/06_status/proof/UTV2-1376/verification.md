# UTV2-1376 Verification

## Verification

- `npx tsx --test scripts/ops/runtime-verifier-gate.test.ts` - failed before the patch on the missing-SHA regression case, then passed after the patch with 9 tests passing.
- `npx tsx --test scripts/ops/proof-auditor-gate.test.ts` - passed with 16 tests passing; confirms the adjacent auditor gate behavior was not changed.
- `pnpm type-check` - passed.
- `pnpm test` - passed.
- Issue-specific runtime verifier check - a proof file without requested SHA failed with `SHA 0123456789abcdef0123456789abcdef01234567 not found in runtime-verification.md` and `Verdict: FAIL`; the same proof file containing the SHA passed with `Verdict: PASS`.
- `pnpm test:db` - initial `pnpm verify` live DB smoke phase hit transient statement timeouts; targeted retry passed all 7 DB smoke tests.
- `pnpm verify` - passed on the second full run, including live DB smoke and T1 live proof suites.

## Notes

- The live proof suite emitted known stranded-pick warnings from existing live state; the related subtests passed.
- No `test:db`-requiring source files were changed, but `pnpm verify` includes the live DB proof gate and it completed successfully.
