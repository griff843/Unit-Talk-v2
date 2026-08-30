# Diff summary — UTV2-1790

MERGE_SHA: 1486d510ffd6aff27fbc34fc89daedf1949e03f8

Three code files. No `package.json`, no lockfile, no tsconfig, no workflow, no
runtime/DB/application code.

| File | Change |
|---|---|
| `scripts/ops/ops-merge-wrapper.ts` | +138 / −2 |
| `scripts/ops/merge-wrapper.ts` | +107 / −2 |
| `scripts/ops/ops-merge-wrapper.test.ts` | +520 / −15 |

(`git diff --numstat 11920f2d..1486d510 -- scripts/ops/`, the full lane diff.)

Plus lane metadata: `docs/06_status/lanes/UTV2-1790.json` (`file_scope_lock` extended
by exactly one path, `scripts/ops/merge-wrapper.ts`, under explicit PM approval),
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

**2. `abortInProgressSync`** (new, exported, ~100 lines including its rationale
comment). Probes for `MERGE_HEAD`, `REBASE_HEAD` and
`git diff --name-only --diff-filter=U`; if anything is in progress it issues
`git merge --abort` / `git rebase --abort` and re-probes. Returns `cleaned: true`
only when the abort command succeeded AND the re-probe is clean, so a tree it could
not clean is never reported as clean. When it cannot clean, it names exactly what
survived (which residue, and why the abort failed).

The probe distinguishes three outcomes per question, not two (round-3 correction).
`git rev-parse --verify --quiet MERGE_HEAD` exits 1 when the ref is *absent* and 128
when the question could not be *answered* — a broken repository, a permissions
failure, git missing. Collapsing those into `false` sent an unreadable worktree down
the "nothing to abort" early return, where the autostash is popped into a
possibly-unmerged index and the mutex released. An `undetermined` list is therefore
tracked separately and forces the fail-closed branch whenever it is non-empty, both
before the abort — where the function also declines to fire a blind `--abort` at a
repository it cannot read — and after it.

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
   ordering the P1 asks for is therefore structural, not incidental. The call is
   wrapped in `try`/`catch` (round-3 correction): the hook is caller-supplied, and an
   unguarded throw exited `runMergeWrapper` with the lock held, the stash unpopped and
   no structured result at all. A throw now becomes the fail-closed result with the
   thrown message surfaced.

2. **New result code `merge_wrapper_cleanup_failed`.** Distinct from
   `merge_wrapper_command_failed`, which now means "the command failed and the
   substrate is clean".

3. **Fail-closed early return.** When the hook reports `cleaned: false`, the stash is
   NOT popped (popping into an unmerged index only makes recovery harder), the lock is
   NOT released, and the result carries the original command's `stdout`/`stderr`
   verbatim plus an actionable recovery message naming the residue and the stash entry.
   That message (round-3 correction) names `pnpm ops:merge-lock release --issue <id>
   --branch <branch>` — `scripts/ops/merge-mutex.ts:614`, a verb that actually
   releases — and states explicitly that `pnpm ops:merge-wrapper guard`, which it
   named before, only ASSERTS the lock is held.

4. **New option `reportedCommand`** (round 4). What the wrapper RUNS is always
   `command`; what it REPORTS is this vector when the caller bridged a different
   operation through this one. `runExtendedMergeWrapper` bridges `git-merge-main` /
   `git-rebase-main` through the `main-sync` slot and substitutes the real invocation
   inside its runner, so without this every result — including the fail-closed one
   whose whole job is to tell an operator what left `MERGE_HEAD` behind — reported
   `git pull --ff-only origin main`, a command that cannot leave a merge in progress.
   Round 3's proof asserted the opposite of what the code did; see finding 10 in
   `verification.md`.

No existing caller passes `onCommandFailure`, so every other operation's behaviour is
unchanged; `scripts/ops/merge-wrapper.test.ts` is green unmodified (21/21).

## `scripts/ops/ops-merge-wrapper.test.ts`

1. **Truth corrections.** Three assertions asserted the literal `'--ff-only'` for
   `git-merge-main` and now assert `'--no-ff', '--no-edit'`. Two failure-path
   assertions now also include the three cleanup probe calls, because the wrapper
   genuinely issues them. The four remaining `--ff-only` occurrences belong to
   `main-sync`'s legitimate `git pull --ff-only origin main` and are unchanged.

2. **Eight real-git regressions.** Helpers `git(cwd, ...args)`,
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
   - *an undeterminable worktree state fails closed* — a real conflicted merge IS in
     progress, but every state probe is forced to git's fatal exit 128. Asserts
     `merge_wrapper_cleanup_failed`, a message saying the state could not be
     determined, the lock still `held`, `main_sync_stash.popped === false`, a message
     naming `ops:merge-lock release`, and the lane HEAD unchanged.
   - *a throwing cleanup hook fails closed rather than escaping* — calls
     `runMergeWrapper` directly with a hook that throws; asserts the throw does not
     propagate, the structured `merge_wrapper_cleanup_failed` result is returned with
     the thrown message surfaced, and the lock is still `held`.

3. **Round 4 additions.** Test 53 is a real conflicted `git rebase`, pinning the
   abort verb (`git merge --abort` during a rebase exits 128 and the residue
   survives; hardcoding `merge` survived the entire 52-test suite before this).
   Test 54 masks both refs to ABSENT over a genuinely conflicted index, isolating
   the unmerged-paths term of the nothing-to-abort early return. Test 49 gained
   three pins: the `git stash pop` call was never ISSUED (its previous assertions
   were satisfied by git's own refusal to pop into an unmerged index, so they
   passed with a pop added), and `result.command` / the operator message name the
   real invocation and not the bridge.

4. **Three harness defects fixed in this suite (round 3).** Tests 23 and 24 drove a
   blanket mock returning exit 128 for *every* command including the new probes;
   under the corrected code that is an undeterminable repository, so those tests were
   asserting the ordinary released-lock path through a mock that no longer described
   it. They now answer the probes realistically (`rev-parse` exit 1 with no output,
   `diff` exit 0) — what a command that failed leaving nothing behind actually
   produces. Test 52's first draft failed the `git stash push` too, returning
   `merge_wrapper_stash_failed` before the sync command ran and never reaching the
   hook it exists to test. And `CLEANUP_PROBE_CALLS` listed the probes in the
   pre-rewrite order. None were product defects; two were vacuous-test risks of
   exactly the kind the P1 came from.

   `node:child_process`'s `spawnSync` is used by the helpers; existing conventions
   (`withTempOps`, `BASE`, `readMergeLock`) are reused unchanged.
