# PROOF: UTV2-1790

MERGE_SHA: 77028bb54f53fe0d5aab7414c55d276159c59c5d

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
  is sound rather than assumed), the suite was re-run (50/50), and four mutations
  were executed in this session to prove each control load-bearing (M2, M3, M4/M6,
  M7 below).
- **Corrected** — the file-scope lock had been widened to **two** paths; PM approved
  only `scripts/ops/merge-wrapper.ts`, so `docs/06_status/lanes/UTV2-1790.json` was
  removed, leaving exactly one added entry.
- **Corrected** — the proof asserted `verify:static leg: PASS` while simultaneously
  carrying an unfilled exit-code token for that same command. The duplicate's
  `verify:static` run was interrupted mid-flight and never produced a result, so the
  PASS was unsupported. It is replaced below by a run executed in this session.
- **Not adopted on trust** — every mutation result. Four were re-executed here
  (M2, M3, M4/M6, M7); M1 was executed earlier in this session. Any row not
  independently reproduced is marked as such in the mutation table.
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

### Mutation evidence

Every control this lane adds was inverted individually **in this session**, the
focused suite re-run against the mutant, and the source restored and re-hashed to
prove the revert was byte-exact (`md5sum -c` OK after each). Baseline and restored
state both report `# fail 0` (50/50).

| # | Mutation | Result | Tests killed |
|---|---|---|---|
| M1 | `['merge','--no-ff','--no-edit','origin/main']` → `['merge','--ff-only','origin/main']` | KILLED, `# fail 7` | 2, 23, 27, 47, 48, 49, 50 |
| M2 | `--no-edit` removed | KILLED, `# fail 3` | 2, 23, 27 |
| M3 | `onCommandFailure` wiring removed from the sync path (pre-fix behaviour) | KILLED, `# fail 4` | 23, 24, 48, 49 |
| M4 | `abortInProgressSync`'s failure return reports `cleaned: true` | KILLED, `# fail 1` | 49 |
| M5 | the mutex is released *before* cleanup runs | KILLED, `# fail 2` | 48, 49 |

Survivors: 0.

**What each mutation proves.** M1 is killed behaviourally, not just by shape: tests
47–50 fail because the merge genuinely does not happen under `--ff-only` against a
real diverged repository. **M3 reproduces the reviewed P1 exactly** — with cleanup
unwired, a conflicted merge again releases the mutex and attempts the autostash pop
with `MERGE_HEAD` and unmerged entries still present. M4 proves the fail-closed
`cleaned` computation is load-bearing: a tree that could not be cleaned must never be
reported clean. M5 proves the *ordering* requirement specifically — the assertion
that samples the lock at the instant `git merge --abort` runs fails the moment the
release is moved ahead of cleanup.

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
of this repository and was not run by this session. Two of its variants were not
reproduced here and are therefore **not claimed**; two of its counts differ from the
measurements above because the mutations are not identical. Only the five rows in the
table — each executed here, with the restore verified by hash — are asserted.

## Runtime Verification

This is a `hygiene` lane on the `static` proof profile. It changes orchestrator
tooling scripts and their tests. It issues no database query, performs no network
I/O, and touches no runtime, delivery, ingestion or application code. Runtime proof
is therefore the executed behaviour of the wrapper against real git repositories:
the four regressions spawn actual `git` processes, create real commits on both sides,
create a real conflict, and drive the real (non-injected) git binary. Nothing about
git is mocked. The two cleanup regressions inspect the on-disk repository directly —
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
# tests 50
# suites 0
# pass 50
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
# tests 2657
# suites 20
# pass 2657
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
  Changed files: 9
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

8. **Not fixed, out of scope.** The two other substrate defects observed alongside
   this one -- the dual-root sync-contract persistence in `codex-exec.ts` and CPU/RAM
   scheduling contention during E2E runs -- are deliberately NOT bundled into this
   blocker fix, per the governing order.

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
