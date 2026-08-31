# Diff summary — UTV2-1790

MERGE_SHA: 905c14d403306d7c179922a0bf6a47a39cff6b0f

Four code files. No `package.json`, no lockfile, no tsconfig, no workflow, no
runtime/DB/application code.

| File | Change |
|---|---|
| `scripts/ops/ops-merge-wrapper.ts` | +342 / −6 |
| `scripts/ops/merge-wrapper.ts` | +292 / −14 |
| `scripts/ops/ops-merge-wrapper.test.ts` | +1792 / −15 |
| `scripts/ops/merge-wrapper.test.ts` | +37 / −4 |

(`git diff --numstat origin/main -- scripts/ops/`, the full lane diff, re-measured at
this head. The fourth file is a round-8 consequence and is called out in
`verification.md` under **Scope** rather than left to be discovered here: the new
`main-sync` pre-flight changed behaviour four PRE-EXISTING fixtures in that sibling
suite depend on, and the edit adds one shared clean-worktree constant plus one option
on each of the four calls. No assertion, expected result code or command-sequence
expectation changes.)

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

**4. `probeSyncResidue` and `worktreeResidue`** (round 6, extended round 7). The probe that lived
inside `abortInProgressSync` is hoisted to module scope and re-exported as
`worktreeResidue`, so the two mutex-release decisions in `merge-wrapper.ts` can ASK
the same question instead of asserting an answer they never measured. It is wired in
as `residueProbe`, alongside `onCommandFailure`, and bound to the real runner for the
same reason.

**5. The post-sync analysis is reachable on a failed-but-committed sync** (round 6).
`if (!result.ok || !preSyncHead) return result;` becomes `if (!preSyncHead) return
result;`. This lane created a path — `merge_wrapper_stash_pop_conflict` — that is
`ok: false` **after the merge has already been committed**, so the head genuinely
moved and neither `classifyDroppedPaths` nor `renderHeadMoveNotice` ran. A failed
result now keeps its own code (reclassifying it would hide the failure) and gains the
re-authorization notice, plus any dropped-path warning, appended to its `stderr`.

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

5. **New option `residueProbe` and the `measureResidue` helper** (round 6). Both
   mutex-release decisions that this lane's failure paths reach now MEASURE the
   worktree before deciding, and report the measurement:

   - **stash-pop failure.** Round 5 retained the lock on every non-zero
     `git stash pop` exit, with a message asserting "the pop left the worktree with
     unmerged entries" that nothing on that path had probed for. `git stash pop` also
     exits 1 with `already exists, no checkout` when the pulled commit starts TRACKING
     a path that was autostashed while untracked — a byte-clean tree, and a
     permanently retained repo-wide mutex. The lock is now retained only over real
     residue or an unanswerable state, and released over a measured-clean tree. It is
     a hard failure either way: lane-state data is stranded in the stash.
   - **stash-push failure.** That branch returns before any cleanup hook can run and
     released the lock unconditionally. `git stash push` refuses over an already
     unmerged index (`could not write index ... needs merge`) — exactly what an
     earlier failed sync leaves behind — so it handed the next lane a conflicted tree.
     Same measurement, same rule.

   `measureResidue` fails closed when no probe is supplied or the probe throws: an
   unmeasured tree is not a clean tree. Round 7 dropped the dead `runner` argument
   from the `residueProbe` context type — the only production probe closed over the
   real runner and ignored it. `popMainSyncStash`'s message no longer asserts
   which of the two failures occurred; it names both and defers to the caller's
   measurement.

No existing caller passes `onCommandFailure` or `residueProbe`, so every other
operation's behaviour is unchanged; `scripts/ops/merge-wrapper.test.ts` is green
unmodified (21/21).

## `scripts/ops/ops-merge-wrapper.test.ts`

1. **Truth corrections.** Three assertions asserted the literal `'--ff-only'` for
   `git-merge-main` and now assert `'--no-ff', '--no-edit'`. Two failure-path
   assertions now also include the three cleanup probe calls, because the wrapper
   genuinely issues them. The four remaining `--ff-only` occurrences belong to
   `main-sync`'s legitimate `git pull --ff-only origin main` and are unchanged.

2. **Sixteen real-git regressions.** Helpers `git(cwd, ...args)`,
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

3. **Round 5 additions.** Test 55 drives real git end to end through the SUCCESS
   path: main advances on a tracked lane-state file, the lane diverges on an
   unrelated path so the merge succeeds, and an uncommitted lane-state edit is
   autostashed and then collides on pop. It asserts the mutex is still `held` — the
   fail-open a round-5 reviewer demonstrated, which the round-4 bundle had certified
   impossible. Test 56 pins `residue`'s third term: the before-probe answers
   truthfully, the abort reports success without being executed, and only the
   post-abort probes are unanswerable.

   In `merge-wrapper.ts` the `releaseMergeLock` call moved **after** the
   stash-pop-conflict branch, and that branch now returns without releasing.
   `popMainSyncStash`'s message was corrected: it said the files "are still stashed
   and were NOT restored", which understates a *conflicting* pop — the worktree also
   carries conflict markers and unmerged entries, and the `git stash pop` it
   suggested fails again until they are resolved.

4. **Round 4 additions.** Test 53 is a real conflicted `git rebase`, pinning the
   abort verb (`git merge --abort` during a rebase exits 128 and the residue
   survives; hardcoding `merge` survived the entire 52-test suite before this).
   Test 54 masks both refs to ABSENT over a genuinely conflicted index, isolating
   the unmerged-paths term of the nothing-to-abort early return. Test 49 gained
   three pins: the `git stash pop` call was never ISSUED (its previous assertions
   were satisfied by git's own refusal to pop into an unmerged index, so they
   passed with a pop added), and `result.command` / the operator message name the
   real invocation and not the bridge.

5. **Three harness defects fixed in this suite (round 3).** Tests 23 and 24 drove a
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

6. **Round 7 additions.** Test 60 is test 57's fixture reached through `main-sync`
   instead of the bridge — the round-7 P1, where round 6's lock-leak fix had never
   applied at all. Test 61 pins the residue probe's own `try`/`catch`. Test 62 drives
   a real interactive rebase stopped at a `break` step and first asserts a healthy
   repository reads clean, so it cannot pass vacuously. Mutants M20, M21 and M22.

   `withCleanCleanupProbes` and `CLEANUP_PROBE_CALLS` were extended to the four refs
   and the two `--git-path` probes the residue sweep now issues. `git rev-parse
   --git-path` always exits 0 and prints a path whether or not the directory exists,
   so the helper answers it that way; answering it with the blanket failure that
   runner uses for the sync command would make the tree read UNDETERMINABLE, which is
   a different test (51).

7. **Round 6 additions.** Test 57 is the negative case test 55 never had: a real
   repository where `origin/main` starts TRACKING a lane-state path that is untracked
   at the lane head, so the merge succeeds, the pop refuses outright, the tree is
   byte-clean (asserted directly on disk before the control), and the mutex must
   therefore be **released**. It also asserts the head-move re-authorization notice
   survives on `result.stderr` and names the pre-sync SHA. Test 58 leaves a genuinely
   stranded conflicted merge in place before the wrapper is invoked, so the autostash
   push refuses, and asserts the lock stays `held` with the residue named. Test 59
   calls `runMergeWrapper` directly, without the injected probe, and asserts the
   unmeasured default is fail-closed — the only test that reaches it.

   Mutants M15 and M16 pin the two release directions, M17 the probe wiring, M18 the
   head-move reachability and M19 the fail-closed default. M14 and M15 are deliberately
   each other's inverse: round 5's fix and round 6's fix differ only by a measurement,
   which is why an unmeasured retention read as safe for a whole round.
