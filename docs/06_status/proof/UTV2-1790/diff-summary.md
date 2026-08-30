# Diff summary — UTV2-1790

MERGE_SHA: 77028bb54f53fe0d5aab7414c55d276159c59c5d

Three code files. No `package.json`, no lockfile, no tsconfig, no workflow, no
runtime/DB/application code.

| File | Change |
|---|---|
| `scripts/ops/ops-merge-wrapper.ts` | +101 / −2 |
| `scripts/ops/merge-wrapper.ts` | +66 / −1 |
| `scripts/ops/ops-merge-wrapper.test.ts` | +399 / −3 |

Plus lane metadata: `docs/06_status/lanes/UTV2-1790.json` (`file_scope_lock` extended
by `scripts/ops/merge-wrapper.ts` and the manifest's own path),
`.ops/sync/UTV2-1790.yml`, `docs/06_status/proof/UTV2-1790/**`.

## `scripts/ops/ops-merge-wrapper.ts`

**1. The command itself**, inside `buildExtendedCommand`'s `git-merge-main` case:

```
-  args: ['merge', '--ff-only', 'origin/main'],
+  args: ['merge', '--no-ff', '--no-edit', 'origin/main'],
```

`--ff-only` cannot merge a diverged branch by definition, so `main-sync`'s
recommended divergence exit failed on exactly the condition it exists for. `--no-ff`
preserves both sides' commit SHAs and replays nothing, and it is deliberately not a
bare `git merge`, which would fast-forward a merely-behind branch and make the verb's
effect depend on divergence state. `--no-edit` keeps it noninteractive: a `--no-ff`
merge run from a tty otherwise stops in `$GIT_EDITOR` for the merge-commit message.

**2. `abortInProgressSync`** (new, exported, ~70 lines including its rationale
comment). Probes for `MERGE_HEAD`, `REBASE_HEAD` and
`git diff --name-only --diff-filter=U`; if anything is in progress it issues
`git merge --abort` / `git rebase --abort` and re-probes. Returns `cleaned: true`
only when the abort command succeeded AND the re-probe is clean, so a tree it could
not clean is never reported as clean. When it cannot clean, it names exactly what
survived (which residue, and why the abort failed).

**3. Wiring**, in `runExtendedMergeWrapper`: the `runMergeWrapper` call for
`git-merge-main` / `git-rebase-main` now passes `onCommandFailure`, bound to the
**real** runner (not the intercepting one) and to the cwd the failure occurred in.
No other operation passes it.

Nothing else in the file changes. All five safety invariants the wrapper is
responsible for live **outside** `buildExtendedCommand`:

| Invariant | Where it lives | Touched |
|---|---|---|
| merge mutex acquire/release | `runExtendedMergeWrapper` / `runMergeWrapper` | ordering hardened, semantics preserved |
| protected proof/manifest dropped-path refusal | `PROTECTED_SYNC_PATH_PREFIXES`, `classifyDroppedPaths` | no |
| head-move invalidation reporting | `buildHeadMoveInvalidation`, `renderHeadMoveNotice`, `HEAD_MOVE_REAUTHORIZATION_ORDER` | no |
| `main-sync` divergence refusal (`merge_wrapper_diverged_requires_explicit_sync`) | `runExtendedMergeWrapper` | no |
| raw-command interception | `BLOCKED_RAW_COMMANDS` | no |

## `scripts/ops/merge-wrapper.ts`

Three changes, all on the command-failure path of `runMergeWrapper`. This file was
added to the lane's scope because the stash pop and the mutex release the review P1
is about live here and nowhere else.

1. **New option `onCommandFailure`.** Invoked only when the operation's command exits
   non-zero, and invoked BEFORE the autostash pop and BEFORE `releaseMergeLock`. The
   ordering the P1 asks for is therefore structural, not incidental.

2. **New result code `merge_wrapper_cleanup_failed`.** Distinct from
   `merge_wrapper_command_failed`, which now means "the command failed and the
   substrate is clean".

3. **Fail-closed early return.** When the hook reports `cleaned: false`, the stash is
   NOT popped (popping into an unmerged index only makes recovery harder), the lock is
   NOT released, and the result carries the original command's `stdout`/`stderr`
   verbatim plus an actionable recovery message naming the residue and the stash entry.

No existing caller passes `onCommandFailure`, so every other operation's behaviour is
unchanged; `scripts/ops/merge-wrapper.test.ts` is green unmodified (21/21).

## `scripts/ops/ops-merge-wrapper.test.ts`

1. **Truth corrections.** Three assertions asserted the literal `'--ff-only'` for
   `git-merge-main` and now assert `'--no-ff', '--no-edit'`. Two failure-path
   assertions now also include the three cleanup probe calls, because the wrapper
   genuinely issues them. The four remaining `--ff-only` occurrences belong to
   `main-sync`'s legitimate `git pull --ff-only origin main` and are unchanged.

2. **Four real-git regressions.** Helpers `git(cwd, ...args)`,
   `withDivergedRepo({conflicting}, run)`, `realGitRunner(hook)`, `unmergedPaths(dir)`
   and `mergeHeadPresent(dir)` build a temporary repository with a real
   `refs/remotes/origin/main` ref and genuine divergence, asserted mechanically before
   the wrapper runs (`git rev-list --left-right --count origin/main...HEAD` === `1\t1`).
   The fixture also writes an **untracked** `.ops/sync/UTV2-1790.yml` so the wrapper's
   autostash actually stashes something — without it every "the stash was restored"
   assertion would be vacuously true.

   - *merges a genuinely diverged branch* — ok; a merge commit exists;
     `git rev-list --parents -n 1 HEAD` parents equal the two pre-merge SHAs
     byte-for-byte; both original SHAs still resolve; lane-side file preserved and
     main-side content present; mutex released. Runs with `GIT_EDITOR=false`.
   - *a real conflict fails, aborts the merge, restores the stash, and only then
     releases the mutex* — the seven P1 criteria: failure reported (as
     `merge_wrapper_command_failed`, with the conflict diagnostic preserved); lane HEAD
     unchanged; `MERGE_HEAD` absent; `git diff --name-only --diff-filter=U` empty;
     stash restored (`main_sync_stash.stashed === true` **and** `popped === true`, the
     file back on disk, `git stash list` empty); worktree byte-identical to the
     pre-attempt state with no conflict markers; and the lock file read from **inside**
     the abort call still says `held`, proving release happened only after cleanup.
   - *a cleanup failure fails closed* — the abort is intercepted and not executed, so
     the conflicted state genuinely survives. Asserts `merge_wrapper_cleanup_failed`
     (not the ordinary code), `MERGE_HEAD` really still present, unmerged paths really
     still present, lock still `held`, no `release` reported, `main_sync_stash.popped
     === false`, stash entry still listed, and the message naming both the abort
     failure and the residue.
   - *records a merge commit when merely behind* — guards against a bare `git merge`
     fast-forwarding.

   `node:child_process`'s `spawnSync` is used by the helpers; existing conventions
   (`withTempOps`, `BASE`, `readMergeLock`) are reused unchanged.
