# PROOF: UTV2-1790

MERGE_SHA: 1486d510ffd6aff27fbc34fc89daedf1949e03f8

`pnpm ops:merge-wrapper main-sync` is the only sanctioned way to bring `origin/main`
into a lane branch. When it detects divergence it refuses and names two explicit
exits, recommending `git-merge-main` because it "preserves history and SHAs".
`git-merge-main` built `git merge --ff-only origin/main`, which cannot merge a
diverged branch by definition. The verb therefore failed on exactly the condition
it exists for, and the only operable exit left was `git-rebase-main`, which rewrites
history, moves the head SHA, and invalidates every head-pinned governance artifact
(pm-verdict, t1-approved evidence, executor-result).

Making the merge *possible* then exposed a second, worse defect on the same path:
a non-fast-forward merge can conflict, and the wrapper's failure path popped its
lane-state autostash and released the merge mutex while `MERGE_HEAD` and unmerged
index entries were still in the worktree. That was raised as a P1 on review and is
fixed in this lane; both halves are covered below.

**Lane verdict: `main-sync`'s recommended divergence exit is now operable,
noninteractive, and transactional — it either merges or leaves the worktree exactly
as it found it, and it never hands a half-merged worktree to the next lane. No
wrapper safety invariant is weakened.**

## Provenance of this lane's implementation

This section exists because part of the code proven below was **not authored by the
executor that is certifying it**, and a proof that hid that would be exactly the
defect this program is trying to eliminate.

**What happened.** At 20:39 UTC the lane worktree was verified clean (`git status
--porcelain` empty, local HEAD = remote = PR head `11920f2d`). At 20:56 UTC it
contained uncommitted edits the certifying session had not made. Investigation
established the writer mechanically: a second `claude --dangerously-skip-permissions`
process, **PID 4980**, distinguished from the certifying session (**PID 2909**) by a
different shell snapshot (`snapshot-bash-1788120836977-5ux3dh.sh` vs
`…1788120709981-1l6ryu.sh`), running `pnpm verify:static` with the lane worktree as
its `cwd`. Cause, confirmed by the operator: a prompt was sent to the wrong terminal,
starting duplicate work on this lane. The duplicate was stood down deliberately by
the operator, not killed by this session.

**Containment, verified rather than assumed.** The duplicate never committed and
never pushed: local HEAD, `origin/…`, and the PR head were all `11920f2d` throughout.
Every change it made was uncommitted working-tree state.

**Preserved evidence.** Two snapshots were taken and retained:

| Snapshot | Captured | Contents |
|---|---|---|
| `unattributed-1790-165707.patch` | 16:57 EDT, 14,602 B | 3 files, mid-write |
| `unattributed-1790-STABLE-171230.{patch,status,md5}` | 17:12 EDT, 70,711 B | 7 files, stable; the adoption baseline |

Adoption-baseline hashes: `merge-wrapper.ts` `b2948506…`, `ops-merge-wrapper.ts`
`9b664702…`, `ops-merge-wrapper.test.ts` `b946a3ca…`, plus the four lane/proof files.
Stability was proven by four hash samples over 75 s with no live process holding the
worktree, **after** the duplicate stopped — not before.

**How it was adopted.** As untrusted input, never as authored work. Every line was
reviewed against the accepted contract, and the behavioural claims were re-earned by
execution in this session:

- **Retained after independent verification** — the `--no-edit` flag; the
  `onCommandFailure` hook and its placement before the autostash pop and the mutex
  release; `abortInProgressSync` and its fail-closed `cleaned` computation; the
  `merge_wrapper_cleanup_failed` result code; the real-git conflict and
  cleanup-failure regressions. Type-check was re-run (exit 0, which also proves the
  `ExtendedMergeWrapperOperation` → `'git-merge-main' | 'git-rebase-main'` narrowing
  is sound rather than assumed), the suite was re-run (54/54), and the full
  twelve-mutant battery below (M1-M12) was executed in this session to prove each
  retained control load-bearing.
- **Corrected** — the file-scope lock had been widened to **two** paths; PM approved
  only `scripts/ops/merge-wrapper.ts`, so `docs/06_status/lanes/UTV2-1790.json` was
  removed, leaving exactly one added entry.
- **Corrected** — the proof asserted `verify:static leg: PASS` while simultaneously
  carrying an unfilled exit-code token for that same command. The duplicate's
  `verify:static` run was interrupted mid-flight and never produced a result, so the
  PASS was unsupported. It is replaced below by a run executed in this session.
- **Not adopted on trust** — every mutation result. All twelve rows of the table
  below (M1-M12) were executed in this session against the current source. No
  mutation result from the unattributed diff is carried forward; see **Not
  asserted** under the mutation table.
- **Noted** — the duplicate left a 0-byte `docs/06_status/lanes/UTV2-99102.json`,
  test pollution into the live manifest directory, which it then cleaned up. It is
  absent from the final tree and from this PR.

**Statement of authorship.** Acceptance of the retained portions rests on review and
re-execution in this session, not on assumed authorship. Where a claim below could
not be reproduced here, it is not made.

## Verification

ASSERTIONS:

- [x] The defect is real and was reproduced against a genuinely diverged branch,
      not a simulated one. The regression fixture builds a temp repository with a
      real `refs/remotes/origin/main` and asserts divergence mechanically:
      `git rev-list --left-right --count origin/main...HEAD` returns `1	1`
      (one commit each side) before the wrapper is invoked.
- [x] `git-merge-main` now merges a genuinely diverged branch successfully.
- [x] History is not rewritten. After the merge, `git rev-list --parents -n 1 HEAD`
      lists exactly the pre-merge branch SHA and the pre-merge `origin/main` SHA as
      parents, byte-for-byte, and both original SHAs still resolve via `rev-parse`.
      Nothing is replayed, so no commit changes identity.
- [x] `--no-ff` is deliberate, not incidental. A bare `git merge` would fast-forward
      a merely-behind branch, silently moving it with no merge commit and making the
      operation's effect depend on divergence state. A dedicated regression asserts a
      merge commit is recorded in the merely-behind case too.
- [x] The merge is noninteractive. `--no-edit` is passed, so a `--no-ff` merge never
      stops in `$GIT_EDITOR` for a merge-commit message on a caller that has a tty.
- [x] **A failed merge is transactional (P1 remediation).** On a real content
      conflict the wrapper now aborts the in-progress merge BEFORE it restores the
      lane-state autostash and BEFORE it releases the mutex. The regression asserts
      all seven properties on a real conflicted repository: failure is reported; the
      lane HEAD is unchanged; `MERGE_HEAD` is absent afterward;
      `git diff --name-only --diff-filter=U` returns nothing; the lane-state stash is
      restored (and the untracked lane-state file is back on disk with `git stash list`
      empty); the worktree is byte-identical to its pre-attempt state with no conflict
      markers; and the mutex is still `held` at the instant the abort runs, released
      only after cleanup finished.
- [x] **Cleanup failure fails closed (P1 remediation).** If the abort itself fails,
      the wrapper does NOT report an ordinary `merge_wrapper_command_failed`. It
      returns the distinct `merge_wrapper_cleanup_failed`, retains the mutex, leaves
      the autostash unpopped, and names the residue. The regression proves this
      against a genuinely unsafe substrate — `MERGE_HEAD` and unmerged paths really
      are still present when the assertion runs; the danger is not simulated.
- [x] The original merge diagnostics survive the cleanup path. Both the ordinary and
      the fail-closed result still carry the conflict text
      (`/conflict|CONFLICT|Automatic merge failed/u`), not the abort's output.
- [x] Merge mutex acquisition and release are preserved. The lock file is asserted
      released after the successful merge and after the cleanly-aborted failing one,
      and asserted RETAINED on the cleanup-failure path.
- [x] Protected-path refusal is preserved. `classifyDroppedPaths` and
      `PROTECTED_SYNC_PATH_PREFIXES` (including `docs/06_status/proof/`) are untouched
      and live outside `buildExtendedCommand`.
- [x] Head-move invalidation reporting is preserved. `buildHeadMoveInvalidation`,
      `renderHeadMoveNotice` and `HEAD_MOVE_REAUTHORIZATION_ORDER` are untouched.
- [x] The `main-sync` divergence refusal itself is preserved. The wrapper still
      refuses with `merge_wrapper_diverged_requires_explicit_sync` rather than
      silently substituting a rebase; this lane makes the recommended manual exit
      work, it does not restore any automatic substitution.
- [x] `BLOCKED_RAW_COMMANDS` is unchanged, so the raw commands the wrapper exists to
      intercept are still intercepted.
- [x] No other operation's behaviour changes. The cleanup hook is passed only for
      `git-merge-main` and `git-rebase-main`; `pr-merge`, `main-sync` and the deferred
      path never receive it and their call sequences are unchanged in the suite.
- [x] An **undeterminable** worktree state is never reported clean. `git rev-parse
      --verify --quiet MERGE_HEAD` exits non-zero both when the ref is absent
      (status 1) and when the question could not be answered at all (status 128, a
      broken repository or missing git). `abortInProgressSync` tracks the second case
      separately and fails closed on it, rather than taking the "nothing to abort"
      early return. Proven by test 51 (real conflicted merge, probes forced to 128)
      and by mutant M6.
- [x] A **throwing** cleanup hook fails closed rather than escaping.
      `onCommandFailure` is a caller-supplied injection point; the call is wrapped so
      that a thrown error becomes the `merge_wrapper_cleanup_failed` result with the
      thrown message surfaced, instead of unwinding out of `runMergeWrapper` with the
      lock held and no structured result. Proven by test 52 and by mutant M7.
- [x] The fail-closed message names a **real** recovery verb. It directs the operator
      to `pnpm ops:merge-lock release --issue <id> --branch <branch>`
      (`scripts/ops/merge-mutex.ts:614`) and states explicitly that
      `pnpm ops:merge-wrapper guard` only ASSERTS the lock is held and does not
      release it.
- [x] The message and `result.command` name the git invocation that **actually ran**,
      not the `main-sync` pull it is bridged through. This was asserted in round 3 and
      was **false**: `commandVector` came from the bridged input, so a fail-closed
      result named `git pull --ff-only origin main` — a command that cannot leave
      `MERGE_HEAD` behind — and handed the operator three inconsistent identities in
      one message. Round 4 adds a `reportedCommand` option: what is RUN is still
      `command`, what is REPORTED is the caller's real vector. Proven by test 49's
      `deepStrictEqual(result.command, ['git','merge','--no-ff','--no-edit',
      'origin/main'])` plus a `doesNotMatch(/git pull --ff-only/u)` on the message,
      by test 53's rebase equivalent, and by mutant M9.
- [x] The abort verb follows the operation. `git merge --abort` during a rebase exits
      128 (`There is no merge to abort`) and the residue survives, so a hardcoded verb
      turns automatic recovery into a manual-recovery incident for `git-rebase-main`.
      It fails closed rather than open, but it was entirely unpinned: hardcoding
      `merge` survived the whole suite until test 53, a real conflicted rebase, was
      added. Proven by test 53 and mutant M10.
- [x] The fail-closed branch does not even ATTEMPT the autostash pop. Test 49's
      `popped === false` and "stash entry still listed" are satisfied by git's own
      refusal to pop into an unmerged index, so they passed with a pop added to that
      branch — the control was unpinned by a vacuous assertion. Test 49 now asserts
      the `git stash pop` call was never issued. Proven by mutant M11.
- [x] Unmerged entries ALONE block the nothing-to-abort early return. Every real
      conflict leaves `MERGE_HEAD` too, so no test isolated the third term and
      dropping it survived. Test 54 masks both refs to ABSENT (git exit 1, not the
      exit 128 of test 51, so the `undetermined` path cannot be what carries it) over
      a genuinely conflicted index, and asserts the abort is issued. Proven by mutant
      M12.
- [x] **Scope note on `main-sync`.** `runMergeWrapper` accepts `onCommandFailure`
      from any caller, but the only caller that supplies one is
      `runExtendedMergeWrapper`, and only for the two git sync verbs. A direct
      `main-sync` call therefore receives no cleanup hook. That is safe rather than
      an omission: `main-sync` delegates the merge to `ops:merge-wrapper`'s own
      bridged path, and a `main-sync` invocation that runs no merge leaves no
      `MERGE_HEAD` to abort. Documented here rather than broadened, per the scope
      constraint on this lane.

### Mutation evidence

Every control this lane adds was inverted individually **in this session**, the
focused suite re-run against the mutant, and the source restored and re-hashed to
prove the revert was byte-exact (`md5sum -c` OK after each). Baseline and restored
state both report `# fail 0` (54/54).

| # | Mutation | Result | Tests killed |
|---|---|---|---|
| M1 | `['merge','--no-ff','--no-edit','origin/main']` → `['merge','--ff-only','origin/main']` | KILLED, `# fail 7` | 2, 23, 27, 47, 48, 49, 50 |
| M2 | `--no-edit` removed | KILLED, `# fail 3` | 2, 23, 27 |
| M3 | `onCommandFailure` wiring removed from the sync path (pre-fix behaviour) | KILLED, `# fail 5` | 23, 24, 48, 49, 51 |
| M4 | `abortInProgressSync`'s failure return reports `cleaned: true` | KILLED, `# fail 1` | 49 |
| M5 | the `if (cleanup && !cleanup.cleaned)` fail-closed branch removed, so the wrapper pops and releases anyway | KILLED, `# fail 3` | 49, 51, 52 |
| M6 | an undeterminable probe treated as absence (`if (before.undetermined.length > 0)` → `if (false)`) | KILLED, `# fail 1` | 51 |
| M7 | the `try`/`catch` around the `onCommandFailure` call removed, so a throwing hook escapes | KILLED, `# fail 1` | 52 |
| M8 | the mutex released anyway inside the fail-closed branch, before returning | KILLED, `# fail 3` | 49, 51, 52 |
| M9 | `reportedCommand` removed, so results name the bridged `main-sync` pull | KILLED, `# fail 2` | 49, 53 |
| M10 | the abort verb hardcoded to `merge` regardless of operation | KILLED, `# fail 1` | 53 |
| M11 | a `git stash pop` attempted inside the fail-closed branch | KILLED, `# fail 1` | 49 |
| M12 | `&& before.unmerged.length === 0` dropped from the nothing-to-abort early return | KILLED, `# fail 1` | 54 |

Survivors: 0.

**M9-M12 are round 4**, added because an independent reviewer demonstrated that each
of those four controls was unpinned — M9's was not merely unpinned but asserted and
false. See finding 10.

**What each mutation proves.** M1 is killed behaviourally, not just by shape: tests
47-50 fail because the merge genuinely does not happen under `--ff-only` against a
real diverged repository. **M3 reproduces the reviewed P1 exactly** — with cleanup
unwired, a conflicted merge again releases the mutex and attempts the autostash pop
with `MERGE_HEAD` and unmerged entries still present. M4 proves the fail-closed
`cleaned` computation is load-bearing: a tree that could not be cleaned must never be
reported clean. M5 and M8 prove the two halves of the fail-closed contract
separately — M5 that the branch must exist at all, M8 that it must not release the
mutex on its way out. **M6 reproduces the reviewed round-2 P2 exactly**: collapsing
"the probe could not answer" into "the ref is absent" sends an undeterminable tree
down the "nothing to abort" early return, pops the autostash into a possibly-unmerged
index and releases the mutex — the same fail-open class as the original P1, one layer
down. M7 proves the hook boundary is guarded: `onCommandFailure` is caller-supplied,
and without the `try`/`catch` a throwing hook exits `runMergeWrapper` with the lock
held, the stash unpopped and no structured result — a stack trace instead of recovery
instructions. **M9** proves the reported command is the one that actually ran: without
`reportedCommand` the fail-closed result names `git pull --ff-only origin main`, which
cannot leave `MERGE_HEAD` behind, so the operator is pointed away from the residue.
**M10** proves the abort verb follows the operation — `git merge --abort` during a
rebase exits 128 and the residue survives. **M11** proves the fail-closed branch never
attempts the pop, which git's own refusal would otherwise disguise. **M12** proves
unmerged entries alone block the nothing-to-abort early return.

**Honest scope note on M2.** M2 is killed only by command-shape assertions, not
behaviourally. `git merge --no-ff` opens `$GIT_EDITOR` only when run from a terminal,
and the wrapper spawns git with piped stdio, so no test in this harness can make
`--no-edit` behaviourally load-bearing. `--no-edit` is the guarantee for callers that
DO have a tty — a developer running `pnpm ops:merge-wrapper` interactively — and the
shape assertion is what pins it. The success regression additionally sets
`GIT_EDITOR=false` for the duration of the merge, proving the merge completes without
depending on an editor being available at all.

**Not asserted.** The unattributed diff (see Provenance) arrived with a
seven-mutation battery transcript produced by a `battery.py` script that is not part
of this repository and was not run by this session. **None of its results are
carried forward.** The twelve rows above were each executed here against the current
source, with the restored baseline re-confirmed green after each; they are the only
mutation claims made.

## Runtime Verification

This is a `hygiene` lane on the `static` proof profile. It changes orchestrator
tooling scripts and their tests. It issues no database query, performs no network
I/O, and touches no runtime, delivery, ingestion or application code. Runtime proof
is therefore the executed behaviour of the wrapper against real git repositories:
the eight regressions spawn actual `git` processes, create real commits on both sides,
create a real conflict, and drive the real (non-injected) git binary. Nothing about
git is mocked. Three of the cleanup regressions (48, 49, 51) inspect the on-disk
repository directly —
`MERGE_HEAD`, `git diff --diff-filter=U`, `git stash list`, `git status --porcelain`
— rather than trusting the wrapper's own report.

### Unit test output

Focused suite, `scripts/ops/ops-merge-wrapper.test.ts`:

```
ok 1  - BLOCKED_RAW_COMMANDS lists every bypassable raw command
ok 2  - buildExtendedCommand constructs git-merge-main command
ok 23 - git-merge-main releases the lock after command failure
ok 24 - git-rebase-main releases the lock after command failure
ok 27 - git-merge-main completes successfully and releases the lock
ok 47 - UTV2-1790: git-merge-main merges a genuinely diverged branch (real git)
ok 48 - UTV2-1790: a real conflict fails, aborts the merge, restores the stash, and only then releases the mutex
ok 49 - UTV2-1790: a cleanup failure fails closed — mutex retained, stash held, distinct code
ok 50 - UTV2-1790: --no-ff still records a merge commit when the branch is merely behind
ok 51 - UTV2-1790: an undeterminable worktree state fails closed instead of reporting clean
ok 52 - UTV2-1790: a cleanup hook that throws fails closed rather than escaping
ok 53 - UTV2-1790: a real rebase conflict is aborted with the REBASE verb, not the merge verb
ok 54 - UTV2-1790: unmerged entries alone block the nothing-to-abort early return
# tests 54
# suites 0
# pass 54
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Sibling suite `scripts/ops/merge-wrapper.test.ts` (the module whose failure path this
lane changes): `# tests 21 / # pass 21 / # fail 0`.

Full ops suite:

```
$ pnpm test:ops
# tests 2661
# suites 20
# pass 2661
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Static verification

EVIDENCE:

```text
$ pnpm type-check
  exit 0 (no diagnostics)

$ pnpm verify:static
  exit 0
  98 test suites reported "# fail 0"; 0 suites reported any failure.
  (ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
   ops:automation-coverage-check, env:check, lint, type-check, build, test,
   smart-form verify, verify:commands -- all green)
  [command-manifest] Verified 14 command definition(s)
  [check-migration-versions] 7 migration file(s) verified -- no duplicate versions.
  [lint-migrations] 6 migration file(s) checked -- no findings.

$ pnpm verify
  pnpm verify = `pnpm verify:static && pnpm test:live-db`.
  verify:static leg: PASS, exit 0, executed in this session (transcript above).
  test:live-db leg: REFUSED locally, by design, not by defect:

    [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
    [assert-staging] REFUSED: target identity could not be resolved from its URL
    (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
    Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

  Under production containment `local.env` carries SUPABASE_URL=http://127.0.0.1:1,
  so `ci:assert-staging` fails closed rather than letting a writable DB test reach an
  unidentified target. The writable-DB receipt for this PR is produced inside the
  required CI `verify` job against the staging project, which is the only sanctioned
  source for it. This lane changes no database, runtime, delivery or ingestion code,
  so it has no live-DB surface of its own to exercise.

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1790
  Verdict: PASS
  Changed files: 10
  Rules matched: (none) -- no R-level artifacts required for this diff
```

## Findings

1. **Root cause A — the verb could not do its job.** `buildExtendedCommand`'s
   `git-merge-main` case emitted `git merge --ff-only origin/main`. `--ff-only`
   refuses any merge that is not a fast-forward, so the command could only ever
   succeed on a branch that was merely behind -- the one case where `main-sync`'s own
   `git pull --ff-only origin main` already works. On the diverged case, which is the
   only reason `git-merge-main` exists, it always failed.

2. **Consequence.** Both sanctioned exits from a diverged lane dead-ended, leaving
   `git-rebase-main` as the only operable path. A rebase moves the head SHA, and
   pm-verdict, t1-approved evidence and executor-result are all head-pinned, so
   taking that path costs a full governance re-authorization. UTV2-1678 removed the
   wrapper's *silent* rebase substitution; leaving `git-merge-main` unusable
   reintroduced the same pressure toward rebasing by omission rather than by default.

3. **Why `--no-ff` and not a bare merge.** A bare `git merge` fast-forwards when it
   can, so the same invocation would sometimes record a merge commit and sometimes
   silently advance the branch. `--no-ff` always records a merge commit and behaves
   identically in both cases, which is what makes the verb's contract stable.

4. **Root cause B — the failure path was not transactional (the review P1).**
   Permitting a non-fast-forward merge permits a *conflicting* one. A conflicted
   `git merge` exits non-zero and leaves `MERGE_HEAD` and unmerged index entries in
   place; `runMergeWrapper` then popped the lane-state autostash (which fails with
   "needs merge") and released the merge mutex. Two concrete harms: the lane-state
   files stayed stuck in the stash, and the next lane could acquire a mutex whose
   entire purpose is to serialize merges while this worktree was still inside the
   previous lane's merge. Every subsequent wrapper run also failed until a human
   aborted by hand. Under `--ff-only` this state was unreachable, so the fix for
   root cause A is what made it reachable — it is this lane's defect to close.

5. **Shape of the fix.** `abortInProgressSync` (in `ops-merge-wrapper.ts`) probes for
   `MERGE_HEAD`, `REBASE_HEAD` and unmerged paths, issues `git merge --abort` /
   `git rebase --abort`, then re-probes. It reports `cleaned: true` only when the
   abort command succeeded AND the re-probe is clean — a tree it could not clean is
   never reported as clean. It is wired into `runMergeWrapper` through a single new
   `onCommandFailure` option that fires after the command and before both the stash
   pop and the release, so the ordering the P1 asks for is structural rather than
   incidental. When cleanup fails, `runMergeWrapper` skips the pop (popping into an
   unmerged index can only make recovery harder), skips the release, and returns the
   new `merge_wrapper_cleanup_failed` code with the original merge diagnostics intact.

6. **Why `scripts/ops/merge-wrapper.ts` is in scope.** The issue's stated scope was
   two files. The stash pop and the mutex release the P1 is about do not live in
   either of them — they live in `runMergeWrapper` in `merge-wrapper.ts`. Correcting
   the ordering anywhere else would have meant re-acquiring a lock after it was
   released, which is racy and dishonest. The change to that file is one new optional
   option, one new result code, and one guarded early return; no existing caller
   passes the option, and `merge-wrapper.test.ts` is green unchanged (21/21). This is
   the same defect, not a broadened one.

7. **Test-suite truth correction.** Three existing assertions asserted the literal
   `'--ff-only'` for `git-merge-main` and were updated. Two failure-path assertions
   additionally now include the cleanup probe calls, because the wrapper genuinely
   issues them. The four remaining `--ff-only` occurrences in the suite belong to
   `main-sync`'s legitimate `git pull --ff-only origin main` and were deliberately
   left unchanged.

8. **Round 3 — two fail-open residuals found by the independent reviewer, both
   closed.** The reviewer's P1 was clean, but two P2s were reproduced by execution
   and fixed here.
   (a) `abortInProgressSync` read *any* non-zero `git rev-parse` as "the ref is
   absent" and any non-zero `git diff` as "no unmerged paths". A repository that
   could not answer the question (git exit 128) therefore took the "nothing to
   abort" early return, and the wrapper popped the autostash into a possibly-unmerged
   index and released the mutex — **the same fail-open class as the P1, one layer
   down**. The probe now tracks an `undetermined` list separately and forces the
   fail-closed branch whenever it is non-empty, before *and* after the abort. Test 51
   and mutant M6.
   (b) `onCommandFailure` is a caller-supplied injection point and was called
   unguarded; a hook that threw unwound out of `runMergeWrapper` with the lock held,
   the stash unpopped and no structured result. The call is now wrapped, and a throw
   becomes `merge_wrapper_cleanup_failed` with the thrown message surfaced. Test 52
   and mutant M7.
   The reviewer also found the fail-closed message named `pnpm ops:merge-wrapper
   guard`, which only *asserts* the lock is held. It now names
   `pnpm ops:merge-lock release --issue <id> --branch <branch>`
   (`scripts/ops/merge-mutex.ts:614`) and says so explicitly.

9. **Round 3 — three test-harness defects in this lane's own suite.** Found while
   fixing the above, and worth recording because each one made a test weaker than it
   read. Tests 23 and 24 drove a blanket mock that returned exit 128 for *every*
   command, including the new cleanup probes; under the corrected code that is an
   undeterminable repository, so those tests were asserting the ordinary
   released-lock path through a mock that no longer described it. They now answer the
   probes realistically (`rev-parse` exit 1 with no output, `diff` exit 0), which is
   what a command that failed leaving nothing behind actually produces. Test 52's
   first draft failed the `git stash push` too, so it returned
   `merge_wrapper_stash_failed` before the sync command ever ran and never reached
   the hook it existed to test. And `CLEANUP_PROBE_CALLS` listed the probes in the
   pre-rewrite order. None of these were product defects, but two of them were
   vacuous-test risks of exactly the kind this lane's P1 came from.

10. **Round 4 — a false proof claim, and three controls nothing pinned.** A second
    independent reviewer, which authored none of the implementation or the proof,
    reproduced every measurement and the whole eight-mutant battery byte-for-byte,
    and then found four things.

    **P2, and the serious one: the proof asserted a behaviour the code did not
    have.** Round 3 claimed the fail-closed message "names the git command that
    actually ran". It did not. `runExtendedMergeWrapper` bridges the sync verbs
    through the `main-sync` slot and substitutes the real invocation inside its
    runner, so `commandVector` — and therefore both `result.command` and that
    message line — rendered `git pull --ff-only origin main`. The operator was
    handed three inconsistent identities in one message (`main-sync`, then the pull,
    then `git-merge-main`) and pointed at the one command that **cannot** leave
    `MERGE_HEAD` behind, actively misdirecting the debugging the round-2 fix existed
    to enable. No test asserted it and no mutant covered it: an asserted control that
    was never demonstrated, and here not merely unproven but false. `runMergeWrapper`
    now takes a `reportedCommand` option — what is RUN is still `command`, what is
    REPORTED is the caller's real vector — and tests 49 and 53 pin it in both
    directions.

    **P3 (a), the abort verb was unpinned.** Hardcoding `merge` survived all 52
    tests: the only real-git cleanup regression was merge-only and the rebase
    coverage was a mock. Test 53 is a real conflicted rebase.

    **P3 (b), a vacuous assertion.** "The stash is deliberately NOT popped" was
    satisfied by git refusing to pop into an unmerged index, not by the control.
    Test 49 now asserts the call was never issued.

    **P3 (c), an unpinned term.** Dropping `&& before.unmerged.length === 0` from
    the early return survived, because every real conflict leaves `MERGE_HEAD` too.
    Test 54 isolates it.

    Recorded plainly because the pattern matters more than the individual defects:
    rounds 2, 3 and 4 each installed the next defect, and two of the four found here
    were **proof-integrity** failures rather than product failures — a claim with no
    test behind it, and an assertion that could not fail. The reviewer's negative
    results are in **Independent review** below.

11. **Not fixed, out of scope.** The two other substrate defects observed alongside
   this one -- the dual-root sync-contract persistence in `codex-exec.ts` and CPU/RAM
   scheduling contention during E2E runs -- are deliberately NOT bundled into this
   blocker fix, per the governing order.

## Independent review

**Round 4 review, of head `da425fad`.** A reviewer that authored none of this
implementation or proof reproduced every measurement independently — 52/52 focused,
21/21 sibling, `type-check` exit 0, `test:ops` 2659/2659 — and reproduced the
**entire eight-mutant battery byte-for-byte**: every `mutant_fail_count` and every
`failing_tests` list in `evidence.json` matched what it measured. Its verdict was
**FAIL**, on one P2 and three P3s, all four of which are fixed above (finding 10) and
pinned by M9–M12.

**What it tried to break and could not** — recorded because a negative result from an
adversarial pass is evidence, and because it is the part of a review that usually goes
unrecorded:

- **No fail-open path exists.** It could construct no route where the stash pops or
  the mutex releases with `MERGE_HEAD`, `REBASE_HEAD` or unmerged entries surviving.
  Real conflicted merge and real conflicted rebase both ended fully clean.
- **Mutex retention is real, not merely "unreleased".** Under a forced cleanup failure
  a second lane against the same lockfile was genuinely refused
  (`merge_wrapper_lock_held`); on every clean path the release was reported `ok`.
- **The `undetermined` classification is not over-broad.** A healthy real repository
  returns `{cleaned: true, aborted: false}` with no needless mutex retention; only a
  genuinely unreadable directory fails closed. The reviewer's inverted mutant —
  treating an absent-ref exit 1 as undetermined — was killed by tests 23, 24, 48, 49.
- **`abortInProgressSync` does not destroy legitimate work.** Unrelated tracked-dirty
  and untracked files survive a conflicted merge plus abort verbatim. An uncommitted
  edit to a file involved in the merge is also safe: git refuses the merge up front,
  cleanup takes the nothing-to-abort path, and the work is preserved.
- **Ordering is genuinely pinned**, by test 48's lock read from inside the abort call;
  the residue re-probe is load-bearing (neutering it was killed).
- **Hook coverage is complete rather than lucky.** `main-sync` is `git pull --ff-only`
  and `pr-merge`/`pr-update-branch` are remote `gh` calls, none of which can leave a
  merge in progress, so the absence of a hook there is safe — confirming the scope
  note above rather than taking it on trust.
- **File scope is honest.** Nine paths versus `main`; the only one outside
  `file_scope_lock` is the lane's own manifest, whose sole change is the one-entry
  widening recorded in provenance.
- **No false review claim** anywhere in the PR or the bundle.

**Review of the current head is PENDING.** The round-4 corrections moved the head, so
the review above does not cover the code that is now proposed for merge. No claim of
completed independent review at this head is made.

## Scope

Authorized code scope, three files touched, nothing else:

- `scripts/ops/ops-merge-wrapper.ts`
- `scripts/ops/ops-merge-wrapper.test.ts`
- `scripts/ops/merge-wrapper.ts` — added to `file_scope_lock` for the P1 remediation;
  justification in Findings 6.

Plus lane-owned metadata: `.ops/sync/UTV2-1790.yml`,
`docs/06_status/lanes/UTV2-1790.json`, `docs/06_status/proof/UTV2-1790/**`.

No workflow file, no production/runtime/DB code, no `package.json`, lockfile or
tsconfig change, no proof-schema change, no branch-protection change, and no bypass
flag. Both `scripts/ops/*merge-wrapper*.test.ts` suites were already wired into the
ops suite, so no test-registration edit was required.

## Merge SHA Binding

Merge SHA: pending merge

`sha_binding.verified_source_sha` is the last commit on this branch that touches a
non-proof path. `merge_sha` is rebound automatically by `post-merge-lane-close.yml`
after merge.
