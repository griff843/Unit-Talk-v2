# Diff summary — UTV2-1785

Two code files. No `package.json`, no workflow, no runtime/DB code.

| File | Change |
|---|---|
| `.claude/hooks/pre-proof-validator.sh` | +250 / −19 |
| `scripts/ops/proof-check.test.ts` | +442 / −1 |
| `docs/06_status/proof/UTV2-1785/.gitkeep` | deleted (created by `ops:lane-start`, not in `file_scope_lock`) |

## `.claude/hooks/pre-proof-validator.sh`

1. **Command detection.** `grep -q 'git commit'` on the raw command is replaced
   by `shlex`-based argv walking that skips git's own options (`-c k=v`,
   `--git-dir=...`, env prefixes, absolute paths, `--` terminator) and stops at
   a shell operator. A fail-closed fallback re-checks the raw command with a
   regex when argv walking finds nothing, so shell-wrapped commits
   (`bash -c "git commit ..."`) remain covered. Net detection is a strict
   superset of the previous behaviour.

2. **File selection (`# BEGIN/END MERGE-AWARE SELECTION`).** New. Resolves the
   worktree git dir with `git rev-parse --git-dir`, so `MERGE_HEAD` is found in
   linked worktrees. Non-merge commits keep `git diff --cached HEAD`. Merge
   commits select the union of: paths differing from *both* parents; paths
   differing from `git merge-tree --write-tree HEAD <parent>`'s automatic merge
   result; and the `# Conflicts:` paths recorded in `MERGE_MSG`. Octopus merges
   fall back to the union of all parent diffs. All path handling is
   NUL-delimited.

3. **Validation source.** Both validators now read the staged blob via
   `git show :<path>` instead of the worktree file, and report a failure when
   a proof path is staged as deleted or otherwise unreadable from the index.

4. **Fail-closed parsing.** The evidence validator's `except: sys.exit(0)` —
   which silently passed unparseable JSON — is replaced by a reported failure.

The validation rules themselves are unchanged: `schema_version` non-empty,
`sha_binding.verified_source_sha` a 40-hex SHA, `ci_sentinels` non-empty, at
least one proof block, `status` present; verification files need a
`## Verification` header and more than 100 bytes.

## `scripts/ops/proof-check.test.ts`

Adds 17 top-level tests (42 assertions-level subtests) driving the real hook
against real git repositories — real merges, real conflicts, a real linked
worktree. Nothing about git is mocked. Includes both mutation controls and a
test asserting the hook under test is the tracked file `.claude/settings.json`
actually invokes.
