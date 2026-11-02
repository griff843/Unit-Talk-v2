/**
 * WORK-2026103010. `parseArgs` (shared.ts) binds exactly one value per flag; any
 * further bare word becomes a positional. A CLI that takes a single issue positional
 * must refuse the rest rather than ignore them: `--files a b c` used to admit a lane
 * locked to `a` alone, and a comma-joined `--files a,b` was carried as one
 * nonexistent path. Pure -- callers decide how to report the error.
 */
export function assertSingleIssueArgs(
  positionals: readonly string[],
  flags: ReadonlyMap<string, readonly string[]>,
): void {
  const extra = positionals.slice(1);
  if (extra.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${extra.join(' ')}. Each flag takes one value; ` +
        'repeat --files once per path (--files a --files b).',
    );
  }
  const commaJoined = (flags.get('files') ?? []).filter((value) => value.includes(','));
  if (commaJoined.length > 0) {
    throw new Error(
      `--files takes one path per flag, got comma-joined ${commaJoined.join(' ')}. ` +
        'Repeat --files once per path (--files a --files b).',
    );
  }
}
