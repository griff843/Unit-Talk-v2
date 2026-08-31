# Diff summary — UTV2-1785

MERGE_SHA: b36cbfa532422c56008db44c3764d60c5a7acb7a

Two code files. No `package.json`, no workflow, no runtime/DB code.

| File | Change |
|---|---|
| `.claude/hooks/pre-proof-validator.sh` | +396 / −19 |
| `scripts/ops/proof-check.test.ts` | +586 / −1 |
| `docs/06_status/proof/UTV2-1785/.gitkeep` | deleted (created by `ops:lane-start`, not in `file_scope_lock`) |

## `.claude/hooks/pre-proof-validator.sh`

1. **Command detection and repository resolution (one step).**
   `grep -q 'git commit'` on the raw command is replaced by `shlex`-based argv
   walking that skips git's own options (`-c k=v`, env prefixes, absolute paths,
   `--` terminator), stops at a shell operator, and descends into quoted wrapper
   arguments so `bash -c "git ... commit"` is walked as an argv chain rather
   than a string. A fail-closed fallback re-checks the raw command with a regex
   when tokenization yields nothing at all (an unbalanced quote), so those forms
   stay covered. Net detection is a strict superset of the previous behaviour.

   Detection also collects the global options that choose the target repository
   -- `-C` (chained, attached, relative and symlinked forms), `--git-dir` and
   `--work-tree` -- and resolves the work tree with them applied. Everything
   downstream then addresses that repository. Forms whose target cannot be
   safely resolved are refused rather than guessed: a `-C` into a missing
   directory or a non-work-tree, a bare repository, an explicit `--git-dir`
   whose git dir does not belong to the resolved work tree, and a command
   carrying commits into two different repositories.

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

Adds 22 top-level tests (51 including subtests) driving the real hook
against real git repositories — real merges, real conflicts, a real linked
worktree. Nothing about git is mocked. Includes all three mutation controls and a
test asserting the hook under test is the tracked file `.claude/settings.json`
actually invokes.
