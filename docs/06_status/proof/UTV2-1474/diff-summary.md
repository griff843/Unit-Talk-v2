# UTV2-1474 Diff Summary

## Summary

Fixed the dead `scope-suggest` CLI entrypoint. The prior guard compared `import.meta.url` to a filesystem path, so `pnpm ops:scope-suggest` exited without invoking `main()`.

## Files Changed

- `scripts/ops/scope-suggest.ts`: replaced the entrypoint guard with a `pathToFileURL(process.argv[1]).href` comparison so direct `tsx` execution runs `main()`.
- `scripts/ops/lane-maximizer.ts`: `extractFileScopeFromText` now tolerates a single blank line between a `## File Scope`-style heading and its bullet list before any bullet has been collected — Linear's markdown normalization always inserts one after a `#`-prefixed heading, which previously terminated the scan before any bullets were read. A blank line still ends the block once bullets have started (unchanged end-of-list behavior).
- `scripts/ops/lane-maximizer.test.ts`: added a regression test that invokes `scripts/ops/scope-suggest.ts` through the real `tsx` CLI and asserts JSON output is emitted, plus a second regression test proving `parseQueueCandidates` correctly extracts file scope when the heading is followed by a blank line.

## Scope Notes

- No runtime, domain, contract, DB schema, or migration paths were changed.
- The issue-specific CLI verification confirms `pnpm ops:scope-suggest --description ... --json` now returns a populated suggestion payload.
- This diff-summary and the following note were added by Claude during merge-time diff review (Codex's initial PR fixed the CLI entrypoint and added its regression test, but did not include the `lane-maximizer.ts` blank-line fix required by the issue's acceptance criteria — patched directly before merge).
