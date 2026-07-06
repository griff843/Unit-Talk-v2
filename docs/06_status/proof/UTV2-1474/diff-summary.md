# UTV2-1474 Diff Summary

## Summary

Fixed the dead `scope-suggest` CLI entrypoint. The prior guard compared `import.meta.url` to a filesystem path, so `pnpm ops:scope-suggest` exited without invoking `main()`.

## Files Changed

- `scripts/ops/scope-suggest.ts`: replaced the entrypoint guard with a `pathToFileURL(process.argv[1]).href` comparison so direct `tsx` execution runs `main()`.
- `scripts/ops/lane-maximizer.test.ts`: added a regression test that invokes `scripts/ops/scope-suggest.ts` through the real `tsx` CLI and asserts JSON output is emitted.

## Scope Notes

- No runtime, domain, contract, DB schema, or migration paths were changed.
- The issue-specific CLI verification confirms `pnpm ops:scope-suggest --description ... --json` now returns a populated suggestion payload.
