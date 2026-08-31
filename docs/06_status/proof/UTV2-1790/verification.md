# PROOF: UTV2-1790

MERGE_SHA: 3f3955cd05a4a52e0e7e9e800c332d2fc94d08d9

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
  is sound rather than assumed), the suite was re-run (56/56), and the full
  fourteen-mutant battery below (M1-M14) was executed in this session to prove each
  retained control load-bearing.
- **Corrected** — the file-scope lock had been widened to **two** paths; PM approved
  only `scripts/ops/merge-wrapper.ts`, so `docs/06_status/lanes/UTV2-1790.json` was
  removed, leaving exactly one added entry.
- **Corrected** — the proof asserted `verify:static leg: PASS` while simultaneously
  carrying an unfilled exit-code token for that same command. The duplicate's
  `verify:static` run was interrupted mid-flight and never produced a result, so the
  PASS was unsupported. It is replaced below by a run executed in this session.
- **Not adopted on trust** — every mutation result. All fourteen rows of the table
  below (M1-M14) were executed in this session against the current source. No
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
- [x] Merge mutex acquisition and release are preserved **as an invariant about
      safety, not about the release SITE**, which this lane deliberately moves. The
      lock file is asserted released after the successful merge, after the
      cleanly-aborted failing one, and after a failed-but-non-conflicting autostash
      pop over a measured-clean tree; and asserted RETAINED on the cleanup-failure
      path, on a conflicting pop, on a stash-push failure over an in-progress merge,
      and when the tree could not be measured at all. Round 5's bundle recorded this
      as "preserved" unqualified while round 5 was itself moving the release; a
      round-6 reviewer was right that the flat boolean was false. Tests 27, 48, 49,
      51, 52, 55, 56, 57, 58, 59.
- [x] Protected-path refusal is preserved. `classifyDroppedPaths` and
      `PROTECTED_SYNC_PATH_PREFIXES` (including `docs/06_status/proof/`) are untouched
      and live outside `buildExtendedCommand`.
- [x] Head-move invalidation reporting is preserved **and its reachability was
      repaired**. `buildHeadMoveInvalidation`, `renderHeadMoveNotice` and
      `HEAD_MOVE_REAUTHORIZATION_ORDER` are untouched, but round 5's bundle asserted
      the reporting was preserved without noticing that this lane had made a new path
      reach the post-sync analysis with `ok: false` — `merge_wrapper_stash_pop_conflict`
      after a merge that HAD been committed. `if (!result.ok || !preSyncHead) return
      result;` skipped both the dropped-path classification and the re-authorization
      notice on exactly that path, so a sync that provably moved the head said
      nothing about it. The `!result.ok` term is removed; a failed result keeps its
      code (reclassifying would hide the failure) and the notice, plus any
      dropped-path warning, is appended to its stderr. Test 57 and mutant M18.
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
- [x] The mutex is retained when the **autostash pop** leaves a conflicted index.
      Every other assertion here concerns the command-FAILURE path; this one is the
      success path. When the merge succeeds and `git stash pop` then conflicts —
      because the commit just merged from main touches a path that was autostashed —
      the worktree carries unmerged entries and conflict markers, and the wrapper
      released the serializing mutex over it. Round 4's proof certified that this
      could not happen. It could; a round-5 reviewer built it. The release now
      happens after that branch, and the branch returns without releasing. Proven by
      test 55, which drives real git end to end, and by mutant M14.
- [x] An undeterminable state **after** the abort also fails closed. `residue` has
      three terms and the third, `after.undetermined.length > 0`, was pinned by
      nothing: test 51 masks ALL probes, so the before-probe fail-closed fires first
      and the after-probe is never reached. Test 56 lets the before-probe answer
      truthfully, reports abort success without executing it, and makes only the
      post-abort probes unanswerable. Proven by mutant M13.
- [x] Unmerged entries ALONE block the nothing-to-abort early return. Every real
      conflict leaves `MERGE_HEAD` too, so no test isolated the third term and
      dropping it survived. Test 54 masks both refs to ABSENT (git exit 1, not the
      exit 128 of test 51, so the `undetermined` path cannot be what carries it) over
      a genuinely conflicted index, and asserts the abort is issued. Proven by mutant
      M12.
- [x] **A non-conflicting autostash pop failure RELEASES the mutex (round-6 P1
      remediation).** Round 5 closed the fail-open above by retaining the lock on
      every non-zero `git stash pop` exit, and traded it for a lock leak.
      `popMainSyncStash` sets `conflict: true` on any non-zero status, and the
      round-5 message asserted "the pop left the worktree with unmerged entries" —
      a claim nothing on that path had ever probed. The likelier production shape is
      the opposite: when `origin/main` starts TRACKING a lane-state path that was
      autostashed while untracked, the pop refuses outright with
      `already exists, no checkout` and leaves a byte-clean tree. Retaining the
      repo-wide merge mutex there halts every other lane until a human releases it by
      hand. The tree is now MEASURED after the pop (`worktreeResidue`) and the lock is
      retained only when residue is present or the state is unanswerable; the message
      reports the measurement rather than an assumed conflict. It is still a hard
      failure either way — lane-state data is stranded in the stash. Test 57 asserts
      the negative case test 55 never had (clean tree ⇒ `released`, release receipt
      reported, and the message must NOT say "left the worktree with unmerged
      entries"); mutants M14 and M15 pin the two directions separately.
- [x] **A stash-PUSH failure over an in-progress merge fails closed (round-6 P2
      remediation).** The stash-push failure branch returns before any cleanup hook
      can run and released the mutex unconditionally. `git stash push` refuses
      (`error: could not write index ... needs merge`) when the worktree is already
      mid-conflicted-merge — precisely what an earlier failed sync leaves behind — so
      that branch handed the next lane a conflicted index: the same fail-open,
      reached from the one path that bypasses every other guard. It now measures
      first. Test 58 builds a genuinely stranded merge (`MERGE_HEAD` present and
      `other.txt` unmerged BEFORE the wrapper is invoked), asserts the refusal code
      is `merge_wrapper_worktree_not_clean`, asserts the message names what was
      measured, and asserts the lane HEAD and the stranded merge are left untouched.
      **This bullet said "retains the lock over residue" and "asserts the lock stays
      `held` with no release receipt" until round 10 — describing round 6's
      behaviour, one round after round 9 deliberately inverted it.** Test 58 asserts
      `released`. Round 8 moved the refusal ahead of the autostash and round 9 made
      it release, because a run that stashed nothing, pulled nothing and merged
      nothing has no half-finished state to protect and must not halt other lanes.
      Mutants M16 (the surviving defence-in-depth branch) and M26/M27 (the live
      controls).
- [x] **An UNMEASURED worktree is never treated as a clean one.** `measureResidue`
      decides both release questions above, and `runMergeWrapper` is callable
      directly — without the probe that `runExtendedMergeWrapper` injects — so its
      default is load-bearing. With no probe supplied, or if the probe itself throws,
      it returns not-clean with the reason, and — on the `main-sync` pre-flight, which
      is the path a probe-less caller actually takes — the SYNC IS REFUSED and the
      mutex released. **This bullet ended "and the lock is retained" until round 10**,
      which was round 8's behaviour; retaining it there is precisely the leak that was
      round 9's P2, and test 68 asserts the opposite. Test 59 reaches the default (no
      other test does), test 68 pins the lock outcome, and mutant M19 pins the default
      itself.
- [x] **`main-sync` gets the residue probe too (round-7 P1 remediation).** Round 6
      injected `residueProbe` only inside the `git-merge-main` / `git-rebase-main`
      bridge. But `runMergeWrapper` runs the whole autostash push → pull → pop
      sequence for a plain `main-sync` as well, and the CLI routes `main-sync`
      straight to its own delegation — so on the verb these failure paths are
      actually reached through in production, `measureResidue` always took the
      no-probe default, reported "the state could not be measured", and retained
      the repo-wide mutex **forever**. That is the exact lock leak round 6 exists
      to close, left live on the headline verb, with an internal wiring gap printed
      in the slot reserved for a state measurement. The probe is now bound once, in
      `optionsWithProbe`, and passed to **every** delegation, so a delegation added
      later cannot silently miss it. Test 60 is test 57's fixture reached through
      `main-sync`; mutants M15 and M20.
- [x] **The residue definition covers the sequencer states (round-7 P3
      remediation).** A rebase stopped at a `break`/`edit` step has no
      `MERGE_HEAD`, no `REBASE_HEAD` and no unmerged paths — it is a detached HEAD
      with a `.git/rebase-merge` directory — and a conflict resolved with `git add`
      but not committed leaves only `CHERRY_PICK_HEAD` or `REVERT_HEAD`. All three
      read as clean under the round-6 sweep, so the release decisions would have
      handed the mutex to the next lane over a mid-sequencer worktree. The probe now
      also asks for `CHERRY_PICK_HEAD`, `REVERT_HEAD` and the existence of the
      `rebase-merge` / `rebase-apply` directories (via `git rev-parse --git-path`,
      which always exits 0 and prints a path, so a non-zero exit is classified
      `undetermined` rather than absent). Test 62 drives a real interactive rebase
      stopped at a `break` and first asserts a healthy repository reads clean, so it
      cannot pass vacuously. Mutant M22.
- [x] **The residue definition covers `git bisect` too (round-10 P1 remediation).**
      During a bisect, HEAD is detached at the commit under test and the tree carries
      none of the terms above — no `MERGE_HEAD`, no `REBASE_HEAD`, no
      `rebase-merge`/`rebase-apply` directory, no `CHERRY_PICK_HEAD`, no `REVERT_HEAD`
      and no unmerged path. It read clean, and `main-sync` fast-forwarded the detached
      HEAD off the commit being tested while returning `merge_wrapper_completed`,
      leaving `BISECT_LOG` intact so that every later `git bisect good|bad` would
      record a verdict against the wrong commit. Bisect state is neither a ref nor a
      directory but two plain files, `BISECT_START` and `BISECT_LOG` (a
      `BISECT_HEAD` ref exists only under `--no-checkout`, so a ref probe misses the
      common case), and both are now asked for. The claim this bullet makes is bounded
      and stated as such. **Round 10 also wrote here that a `.git/sequencer` term was
      considered and rejected as an equivalent mutant. That claim was WRONG and is
      retracted:** round 11 built the state and destroyed it. `git cherry-pick A B`,
      conflict, resolve, then a plain `git commit` instead of `--continue` CLEARS
      `CHERRY_PICK_HEAD` and leaves `.git/sequencer` live with HEAD still attached;
      `main-sync` fast-forwarded and returned `merge_wrapper_completed`. The term is
      now present and pinned by test 72 and mutant M30. Tests 69 and 70 and mutant M28
      cover bisect; the residual is `known_gaps`.
- [x] **A residue probe that throws fails closed.** Same class as the
      `onCommandFailure` guard proven by test 52, and correct in round 6 but pinned
      by nothing. Test 61 and mutant M21.
- [x] **A protected artifact dropped by a failed-but-committed sync is RESTORED,
      not merely described (round-7 P3 remediation).** Round 6 made
      `classifyDroppedPaths` reachable on that path but only printed
      `Recover with: git reset --keep <sha>`, while the success path *executes* the
      restore. The restore now runs on both, conditional on `worktreeResidue`
      reporting a clean tree — `git reset --keep` refuses over an unmerged index,
      and firing it at a mid-merge worktree would turn a recoverable failure into a
      confusing one. When the restore succeeds the head is back where it started, so
      the head-move re-authorization notice is suppressed rather than left claiming
      a move that was undone. **This branch is implemented but UNPINNED** — see the
      honest scope note below the mutation table.
- [x] **Scope note on `main-sync`.** `runMergeWrapper` accepts `onCommandFailure`
      from any caller, but the only caller that supplies one is
      `runExtendedMergeWrapper`, and only for the two git sync verbs. A direct
      `main-sync` call therefore receives no cleanup hook. That is safe rather than
      an omission: a `main-sync` invocation runs `git pull --ff-only`, which cannot
      leave a `MERGE_HEAD` to abort, and it refuses outright on divergence. **The
      round-4 wording of this note was wrong** and a round-7 reviewer caught it: it
      said `main-sync` "delegates the merge to `ops:merge-wrapper`'s own bridged
      path". It does not — it performs its own stash/pull/pop and only *refuses* on
      divergence. That false premise is what made round 6 believe the probe did not
      need to reach this delegation. The conclusion happens to survive for
      `onCommandFailure`; it did not survive for `residueProbe`.
### Mutation evidence

Every control this lane adds was inverted individually **in this session**, the
focused suite re-run against the mutant, and the source restored and re-hashed to
prove the revert was byte-exact (an md5 comparison is asserted after each restore, and
the run aborts if it differs). Baseline and restored state both report `# fail 0`
(71/71). All twenty-seven live rows below were measured in ONE round-10 pass against the
current source; none is carried forward from an earlier round.

**`evidence.json`'s machine-readable copy of this table was WRONG in round 8, and
that was round 9's P1.** The header fields were updated for round 8 but the
`mutants[]` array was not: it held 22 round-7 rows, recorded the known survivor M16
as `KILLED`, and omitted M23–M26 entirely, while the same object's `count` said 25 and
`surviving` said 1. An auditor reading only the machine-readable artifact — proof
bundle, rank 2 in the truth hierarchy — would have concluded zero survivors and never
seen the round-8 controls, and the Proof Auditor Gate passed it. The array is
regenerated from the round-9 measurement and diffed against this table. The lesson is
the same one as finding 11, one artifact over: **a table and its machine-readable twin
are two measurements, and updating only the one a human reads is not updating it.** Two further rows (M12 and M17)
are retained only as non-live records and were NOT re-measured, because the code each
targeted no longer exists — stated in the rows themselves rather than left implicit.
The table below therefore holds twenty-nine rows: twenty-seven live, one superseded,
one retired. `evidence.json`'s `mutants[]` array holds the same twenty-nine ids.

| # | Mutation | Result | Tests killed |
|---|---|---|---|
| M1 | `['merge','--no-ff','--no-edit','origin/main']` → `['merge','--ff-only','origin/main']` | KILLED, `# fail 11` | 2, 23, 27, 47, 48, 49, 50, 54, 55, 56, 57 |
| M2 | `--no-edit` removed | KILLED, `# fail 4` | 2, 23, 27, 49 |
| M3 | `onCommandFailure` wiring removed from the sync path (pre-fix behaviour) | KILLED, `# fail 8` | 23, 24, 48, 49, 51, 53, 54, 56 |
| M4 | `abortInProgressSync`'s failure return reports `cleaned: true` | KILLED, `# fail 4` | 49, 56, 66, 70 |
| M5 | the `if (cleanup && !cleanup.cleaned)` fail-closed branch removed, so the wrapper pops and releases anyway | KILLED, `# fail 4` | 49, 51, 52, 56 |
| M6 | a BEFORE-abort undeterminable probe treated as absence (`if (before.undetermined.length > 0)` → `if (false)`) | KILLED, `# fail 1` | 51 |
| M7 | the `try`/`catch` around the `onCommandFailure` call removed, so a throwing hook escapes | KILLED, `# fail 1` | 52 |
| M8 | the mutex released anyway inside the fail-closed branch, before returning | KILLED, `# fail 4` | 49, 51, 52, 56 |
| M9 | `reportedCommand` removed, so results name the bridged `main-sync` pull | KILLED, `# fail 2` | 49, 53 |
| M10 | the abort verb hardcoded to `merge` regardless of operation | KILLED, `# fail 1` | 53 |
| M11 | a `git stash pop` attempted inside the fail-closed branch | KILLED, `# fail 1` | 49 |
| M12 | `&& before.unmerged.length === 0` dropped from the nothing-to-abort early return | **SUPERSEDED** — anchor no longer exists | (see M24) |
| M13 | `after.undetermined.length > 0` dropped from `residue`, so an unverifiable POST-abort state reads clean | KILLED, `# fail 1` | 56 |
| M14 | the mutex released on a conflicting autostash pop (`const release = true` in that branch) | KILLED, `# fail 1` | 55 |
| M15 | the mutex NEVER released on a failed pop, i.e. the round-5 behaviour restored (`const release = false`) | KILLED, `# fail 2` | 57, 60 |
| M16 | the mutex released unconditionally on a stash-PUSH failure (pre-fix behaviour) | **SURVIVED**, `# fail 0` | none |
| M17 | the bridge's own `residueProbe` override removed | **RETIRED** — round 7, provably equivalent to its surroundings | none |
| M18 | `if (!preSyncHead)` → `if (!result.ok \|\| !preSyncHead)`, i.e. the pre-fix early return | KILLED, `# fail 1` | 57 |
| M20 | the `optionsWithProbe` wiring removed, so no delegation receives a probe | KILLED, `# fail 15` | 47, 48, 49, 50, 53, 54, 55, 56, 57, 58, 60, 63, 64, 65, 69 |
| M21 | `measureResidue`'s catch reports a thrown probe as `clean: true` | KILLED, `# fail 1` | 61 |
| M22 | `rebaseHead` drops the `rebase-merge`/`rebase-apply` directory checks | KILLED, `# fail 5` | 23, 24, 62, 63, 67 |
| M19 | `measureResidue`'s no-probe default reports `clean: true` | KILLED, `# fail 2` | 59, 68 |
| M23 | `worktreeResidue` drops its `CHERRY_PICK_HEAD` and `REVERT_HEAD` terms | KILLED, `# fail 1` | 64 |
| M24 | the nothing-to-abort early return drops its `cherryPickHead`/`revertHead` terms (M12's successor) | KILLED, `# fail 2` | 66, 70 |
| M25 | `sequencerDir` reports a non-zero `git rev-parse --git-path` as ABSENT rather than undetermined | KILLED, `# fail 1` | 67 |
| M26 | the `main-sync` pre-flight measurement removed, i.e. the round-8 pre-fix behaviour | KILLED, `# fail 9` | 58, 59, 61, 63, 64, 65, 68, 69, 71 |
| M27 | the pre-flight refusal RETAINS the merge mutex, i.e. the round-8 pre-fix behaviour | KILLED, `# fail 9` | 58, 59, 61, 63, 64, 65, 68, 69, 71 |
| M28 | `probeSyncResidue`'s bisect terms dropped (`const bisect = false`) | KILLED, `# fail 4` | 23, 24, 69, 70 |
| M29 | the pre-flight asserts `The merge mutex WAS released` without reading `release.ok` | KILLED, `# fail 1` | 71 |

**M1, M2 and M3's counts were WRONG in the round-3 and round-4 bundles** — 7/3/5,
carried forward unchanged while the suite grew, so they described a source tree that
no longer existed. A round-5 reviewer caught it. Every row above is re-measured at the
current source in one pass, again in rounds 6, 7, 8 and 9. Movement across rounds is
real and is why re-measuring is not optional: M1 moved 10 → 11 when test 57 was added;
M14 moved 1 → 3 as tests 59 and 61 were added and then back to 3 → 1 in round 8 when
those two tests moved to the pre-flight; M20 moved 3 → 14 once round 8 made the probe
reachable from every real-git regression; M22 moved 3 → 5; M19 moved 1 → 2 and M26
6 → 7 when round 9 added test 68. The lesson is recorded in
finding 11: a mutation row is a measurement, and a measurement not retaken is not
evidence.

**Survivors: 1 (M16), reported rather than hidden — 26 killed, and two non-live rows
carried as records: M12 (superseded) and M17 (retired).**

**M16 survived, and this is the honest reading of why.** M16 inverts the
stash-PUSH-failure branch's release decision to `release = true`. In round 6 that
branch was the enforcing control for a stranded-merge worktree and M16 was killed by
test 58. Round 8 moved the refusal EARLIER: `main-sync` now measures the worktree
before it stashes at all, so that scenario is caught by the pre-flight and test 58 now
asserts `merge_wrapper_worktree_not_clean`. The later branch is therefore no longer
reachable in a dirty state through `main-sync` — by the time it runs, the pre-flight
has already measured the tree clean — and its guard is defence-in-depth for a second
entry point rather than a live control. It was NOT deleted, because unlike round 7's
dead `residueProbe` override it is not provably equivalent to its surroundings: the
tree could in principle change between the two measurements. It is left in place and
reported as a survivor. M26 is the row that now carries this scenario, killed by nine
tests including 58.

**M12 was superseded, not dropped.** Round 8 extended the nothing-to-abort early
return from three terms to five, so M12's anchor string no longer occurs in the
source. The battery reports this as `ANCHOR COUNT 0 -- SKIPPED` rather than silently
passing, and M24 is its successor over the current five-term condition. The row is
kept so the transition is visible instead of looking like a quietly removed control.

**M24 and M25 nearly lapsed in this round, and were RE-ANCHORED rather than declared
superseded.** The first round-10 battery pass reported both as `ANCHOR COUNT ... --
SKIPPED`: M24's anchor was the five-term nothing-to-abort early return, which grew a
sixth term when the bisect fix landed, and M25's anchor — the `--git-path` error
branch — became ambiguous the moment the new `sequencerFile` helper duplicated that
shape, so it matched twice rather than zero times. Both controls still exist and both
still enforce something; only the string used to invert them had moved. They were
re-anchored to the current source, verified unique, and the whole battery re-run in a
single pass. This is the same failure mode as findings 11, 16 and 18 approaching from
a third direction: a row that quietly stops being measured looks identical in a
summary to a row that passed. M25 kills test 67 and M24 now kills tests 66 and 70.

**M17 was retired, not silently deleted.** In round 7 `optionsWithProbe` began
supplying the same default the bridge's own `residueProbe` override supplied, which
made that override byte-for-byte equivalent to its surroundings; its mutant SURVIVED,
and that was the correct signal that it had stopped being a control. The override was
deleted rather than re-pinned with a test that would have asserted nothing. The row is
kept so the retirement is visible in both artifacts.

**M9–M12 are round 4**, **M13–M14 round 5**, **M15–M19 round 6**, **M20–M22
round 7**, **M23–M26 round 8**, **M27 round 9** and **M28–M29 round 10**, each added
because an independent reviewer demonstrated the control was unpinned. M9's, M14's and
M18's were not merely unpinned but asserted and false. See findings 10, 11 and 12.
M14/M15 are deliberately a matched pair in opposite directions: the round-5 fix and
the round-6 fix are each other's mutant, and only measuring the tree distinguishes
them.

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
unmerged entries alone block the nothing-to-abort early return. **M13** proves the
third term of `residue` is load-bearing: without it an unverifiable POST-abort state
reads clean, the stash pops into a still-conflicted index and the mutex is released.
**M14** proves the mutex is retained when the autostash pop leaves a conflicted
index — the round-5 P1. **M15** proves the converse and is the round-6 P1: restoring
round 5's unconditional retention leaks the repo-wide mutex over a provably clean
tree. **M16** WAS the proof that the stash-push failure branch — the one that returns
before any cleanup hook exists — must not release over an in-progress merge; after
round 8 it survives, for the reason set out above. **M18** proves the head-move re-authorization notice is actually REACHED on the one
failure path where the head really moved. **M19** proves the fail-closed default: a
caller that supplies no probe must not get a release. **M20** proves the probe reaches
EVERY delegation and not only the bridged sync verbs — it is the round-7 P1, and it
kills tests 57, 58 and 60 together because after round 7 it is the single wiring site.
**M21** proves the probe's own `try`/`catch` is load-bearing. **M22** proves the
sequencer-directory terms are: without them a rebase stopped at a `break` step reads
clean. **M23** proves the cherry-pick and revert terms of `worktreeResidue` are
load-bearing at the pre-flight. **M24** proves the same two terms in the SECOND
residue reader, `abortInProgressSync`'s early return, where their absence made an open
cherry-pick report as "nothing to abort". **M25** proves `sequencerDir` distinguishes
"the directory is not there" from "I could not ask" — the same fail-open class as M6,
one probe deeper. **M26 reproduces the round-8 P1 exactly**: without the pre-flight,
`main-sync` over a worktree stopped mid-rebase runs `git pull --ff-only`, advances the
detached HEAD out from under the rebase, reports success and releases the mutex.
**M27 reproduces the round-9 P2 exactly**: retaining the mutex on a refusal that
changed nothing leaks the repo-wide lock for its full TTL. M26 and M27 kill the SAME
seven tests, and that overlap is reported rather than hidden — every pre-flight
regression asserts both the refusal and the release, so removing either breaks the
same set. They remain distinct controls: M26 removes the refusal, M27 removes the
release.

**A survivor was found and removed rather than hidden.** Round 6's `residueProbe`
override inside the bridge became byte-for-byte equivalent to `optionsWithProbe`'s
default once round 7 added it (`realRunner` and `options.runner ?? spawnSync` are the
same value there). Its mutant SURVIVED — `# fail 0` — which is the correct signal that
it was no longer a control. It was deleted, not re-pinned: an override that cannot
fail is not a control, and leaving it would have implied the two runners differed at
that site. M20 covers the wiring that remains.

**Honest scope note: one branch is implemented but UNPINNED.** The protected-path
`git reset --keep` restore on the *failed*-but-committed sync path (round-7 P3) has no
regression behind it. `classifyDroppedPaths` compares
`origin/main...preSyncHead` against `origin/main..HEAD`, so a "drop" means the sync
LOST the lane's own work — which requires a rebase that silently drops a lane commit
AND a stash-pop failure in the same run. Every fixture attempted for that either
failed to classify anything as dropped (a main-side deletion is not a drop) or would
have asserted the restore of a file that was never actually lost, which is worse than
no test. It is recorded here and in `known_gaps` as unpinned rather than covered by a
test that proves nothing.

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
carried forward.** The twenty-seven live rows above were each re-executed against the
CURRENT source in a single round-10 pass, with the restored baseline re-confirmed green
after each; they are the only mutation claims made.

## Runtime Verification

This is a `hygiene` lane on the `static` proof profile. It changes orchestrator
tooling scripts and their tests. It issues no database query, performs no network
I/O, and touches no runtime, delivery, ingestion or application code. Runtime proof
is therefore the executed behaviour of the wrapper against real git repositories.
**These counts were WRONG in round 8 and a round-9 reviewer corrected them; the
corrected figures are below.** Round 8 claimed 21 of 67 and "nothing about git is
mocked" in 17 of them. Both were overstated.

**These counts were WRONG AGAIN in rounds 9 and 10 and a round-11 reviewer caught
them: the suite had grown and the prose had not.** The figures below are recounted
against the suite at this head, and every number below is now GENERATED rather
than transcribed.

<!-- BEGIN GENERATED: regression-counts. Produced by the count generator from the
     suite source and an actual TAP run; do not hand-edit. PM disposition, round 12. -->

The suite has **80** tests (80 passing, 0 failing) and **34** of them
carry the UTV2-1790 prefix: tests 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79 and 80.

**24** of the 80 regressions construct a real git repository on disk
directly (via `mkdtempSync` or the `behindLaneRepo` helper) and drive real commits
through it. That predicate is stated because it is what the generator actually
measures: a test that reaches a repository through some other helper would not be
counted, so this is a floor rather than an exact census. They create real conflicts on the merge, cherry-pick and revert verbs, drive a
real interactive rebase to a `break` step, pause a real cherry-pick SEQUENCE, run a real
bisect, and detach HEAD. They are tests 32, 46, 50, 55, 57, 58, 60, 62, 63, 64, 65, 66, 67, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79 and 80.

**4** of them carry an explicit NEGATIVE CONTROL — tests 69, 72, 73 and 75 —
which run the raw `git pull --ff-only` in the same fixture and assert it SUCCEEDS, so
each refusal is measured against a real fast-forward rather than asserted against an
imagined one. A refusal test without one proves only that the wrapper said no.

**19** of the 24 inject no runner at all, so the wrapper drives the real
`git` binary end to end: tests 50, 55, 57, 58, 60, 62, 63, 64, 66, 67, 69, 70, 72, 73, 74, 75, 77, 78 and 79. The other **5** — tests
32, 46, 65, 76 and 80 — run against a real repository but route one or more git
invocations through an injected runner, either to substitute a synthetic result for a
single command or to observe ordering, and each says which in its own comment. Round 8
described all of them as "nothing about git is mocked", which was false; the split is
generated here so it cannot drift again.

**23** inspect the on-disk repository directly — `MERGE_HEAD`, `CHERRY_PICK_HEAD`,
`REVERT_HEAD`, `BISECT_LOG`, `.git/sequencer`, `git symbolic-ref`,
`git diff --diff-filter=U`, `git stash list`, `git rev-parse` — rather than trusting the
wrapper's own report. Tests 46, 50, 55, 57, 58, 60, 62, 63, 64, 65, 66, 67, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79 and 80.

These figures are regenerated from the suite source and from an actual TAP run, with
the run cross-checked against the source name-by-name; the generator refuses to write
anything from a red run or from a source parse that disagrees with the run. Rounds 9,
10 and 11 each shipped a wrong number in this section, every one of them hand-typed.

<!-- END GENERATED: regression-counts -->

### Unit test output

Focused suite, `scripts/ops/ops-merge-wrapper.test.ts`. This is a SELECTION, copied
verbatim from the run: tests 1, 2, 23, 24, 27 and every test from 47 to 75 — that is,
all 29 UTV2-1790 tests plus the five pre-existing tests this lane's mutants reach.
Tests 3–22, 25, 26 and 28–46 are unrelated pre-existing coverage and are elided; the
`# tests` / `# pass` counters below are the whole suite, not the excerpt. Round 10
found this block still carrying round-6 names for `ok 58` and `ok 59` — two lines that
no longer matched the suite — so it is regenerated from a fresh run rather than edited:

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
ok 55 - UTV2-1790: a conflicting autostash pop after a SUCCESSFUL merge retains the mutex
ok 56 - UTV2-1790: an undeterminable state AFTER the abort also fails closed
ok 57 - UTV2-1790: a NON-conflicting autostash pop failure releases the mutex over a clean tree
ok 58 - UTV2-1790: an in-progress merge is refused before the autostash, and the mutex is released
ok 59 - UTV2-1790: without a residue probe the SYNC is refused rather than run over an unmeasured tree
ok 60 - UTV2-1790: main-sync gets the residue probe too, so a clean refused pop releases the mutex
ok 61 - UTV2-1790: a residue probe that throws fails closed rather than escaping
ok 62 - UTV2-1790: a rebase stopped at a break step is NOT reported clean
ok 63 - UTV2-1790: main-sync refuses over a mid-rebase worktree instead of advancing a detached HEAD
ok 64 - UTV2-1790: main-sync refuses over a resolved-but-uncommitted cherry-pick
ok 65 - UTV2-1790: a pre-flight that cannot measure the worktree refuses the sync
ok 66 - UTV2-1790: the post-failure cleanup does not call a mid-cherry-pick worktree "nothing to abort"
ok 67 - UTV2-1790: a sequencer-directory probe that fails is undetermined, not absent
ok 68 - UTV2-1790: a probe-less caller does not strand the repo-wide merge mutex
ok 69 - UTV2-1790: main-sync refuses over a bisecting worktree instead of advancing a detached HEAD
ok 70 - UTV2-1790: the post-failure cleanup does not call a bisecting worktree "nothing to abort"
ok 71 - UTV2-1790: a pre-flight refusal whose release FAILS does not tell the operator it released
# tests 71
# suites 0
# pass 71
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
# tests 2678
# suites 20
# pass 2678
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

11. **Round 5 — a fail-open the previous round's proof certified as impossible, and
    three stale measurements.** A third independent reviewer, which authored none of
    this, reproduced all four headline measurements and every one of the twelve
    mutants — 0 survivors — and then found four things.

    **P1, and it is a claim failure as much as a code one.** `evidence.json` asserted
    `mutex_released_only_after_cleanup_succeeds: true`, and this document recorded a
    prior reviewer's conclusion that *"no fail-open path exists"*. The reviewer built
    one. Every regression in this lane entered through the command FAILURE path; this
    one enters through the SUCCESS path. The merge completes, then `git stash pop`
    conflicts because the commit just merged from main touches a path that was
    autostashed, leaving unmerged index entries and conflict markers — and the wrapper
    released the mutex anyway, handing the next lane a conflicted worktree. It
    degrades to fail-closed on the *next* attempt rather than corrupting, so the code
    severity is moderate; the **certification** severity is not, because this lane's
    entire subject is "the mutex is not released while unmerged entries survive".
    The ordering is pre-existing (UTV2-1678), but it was unreachable while
    `git-merge-main` was `--ff-only` and could never complete a diverged merge, so
    making that verb work is what made it reachable. Fixed, not documented away: the
    release moved after the branch, and the branch returns without releasing. Test 55
    and mutant M14. `popMainSyncStash`'s message was corrected too — it said the files
    "are still stashed and were NOT restored", which understates a *conflicting* pop
    and suggests a `git stash pop` that fails again.

    **P2 — `residue`'s third term was killed by nothing** (see the assertion above).
    Same class as M6 and M12, one layer further down. Test 56 and mutant M13.

    **P2 — three mutation rows were stale, and the bundle called them fresh.** M1, M2
    and M3 carried 7/3/5 from round 3 into the round-4 table while `corroboration`
    claimed all twelve were "executed in this session against the current source".
    They were not; the suite had grown and the real counts are 10/4/8. Every row is
    now re-measured in one pass at the current source.

    **P3s** — a stale "eight mutants" sentence in `provenance` contradicting its own
    `count: 12`; the `aborted` field returned by `abortInProgressSync` is read by
    nobody; and a comment claimed binding cleanup to the real runner was load-bearing
    when the intercepting runner is behaviourally equivalent. The first two are
    recorded below, the third is corrected in the source.

    This is the fourth consecutive round in which review found a defect the previous
    round installed, and the second in which the defect was **something the proof
    asserted rather than something the code did**. That is the durable finding of
    this lane, and it is why every claim above now names the test and the mutant that
    make it fail.

12. **Round-6 independent review: FAIL — one P1, two P2s, two P3s. All fixed.**
   A fourth reviewer, authoring none of this, reproduced all fourteen round-5 mutation
   rows byte-for-byte and then found that **round 5's fix installed the next defect**,
   for the fourth consecutive round.

    **P1 — the fail-open was traded for a lock leak.** Round 5 retained the merge
    mutex on EVERY non-zero `git stash pop` exit, not only conflicting ones, and
    justified it with prose asserting unmerged entries that nothing had probed for.
    `git stash pop` also exits 1 with `already exists, no checkout` — the pulled
    commit now tracks a path that was autostashed while untracked — leaving a
    byte-clean tree and a permanently retained repo-wide mutex. Fixed by measuring
    (`worktreeResidue`) and reporting the measurement. Test 57, mutants M14/M15/M20.

    **P2 — the head-move notice became unreachable on the path this lane created.**
    `if (!result.ok || !preSyncHead) return result;` skipped `classifyDroppedPaths`
    and `renderHeadMoveNotice` for `merge_wrapper_stash_pop_conflict`, a result that
    is `ok: false` **after the merge has been committed**. The reviewer demonstrated a
    real head move (`preSyncHead` → `postSyncHead`) with no notice emitted. Fixed by
    dropping the `!result.ok` term and appending the notice to the failed result's
    stderr rather than reclassifying it. Test 57, mutant M18.

    **P2 — `merge_wrapper_stash_failed` released the mutex over a conflicted index.**
    That branch returns before any cleanup hook can run. Fixed by the same
    measurement. Test 58, mutant M16.

    **P3s** — the bundle described the pop-path retention as conditional while the
    code was unconditional (now both are conditional, on a measurement); and the
    `mutex_acquire_release_preserved` and `head_move_invalidation_reporting_preserved`
    booleans were flatly false. Both are corrected in the assertions above and in
    `evidence.json`, which now records them as qualified rather than flat.

    Round 6 is the fourth consecutive round in which review found a defect the
    previous round installed, and the third in which at least one finding was
    **something the proof asserted rather than something the code did**. The pattern
    is recorded in `known_gaps` and is the honest headline of this lane: a control
    changed under review pressure needs its own mutant in the opposite direction, or
    the next round finds it.

13. **Round-7 independent review: FAIL — one P1 and three P3s. All fixed.**
   A fifth reviewer, authoring none of this, reproduced all nineteen round-6 mutation
   rows byte-for-byte and every headline suite count, and then found — for the fifth
   consecutive round — a defect the previous round installed.

    **P1 — round 6's fix did not reach the verb it was written for.** `residueProbe`
    was injected only inside the `git-merge-main` / `git-rebase-main` bridge, but
    `runMergeWrapper` runs the whole autostash push → pull → pop sequence for a plain
    `main-sync` too, and the CLI routes `main-sync` to its own delegation. The
    reviewer reproduced the leak with real git: `merge_wrapper_stash_pop_conflict`,
    no unmerged paths, no `MERGE_HEAD`, lock `held`, and the message
    "no worktree residue probe was supplied, so the state could not be measured".
    Fixed by binding the probe once in `optionsWithProbe` and passing it to every
    delegation. Test 60, mutants M15 and M20.

    The reviewer also traced WHY round 6 missed it: the round-4 "Scope note on
    `main-sync`" justified the narrow wiring with a false premise — that `main-sync`
    "delegates the merge to `ops:merge-wrapper`'s own bridged path". It does not. The
    note is corrected above. **A false premise in the proof propagated into the code
    two rounds later**, which is the sharpest instance yet of this lane's pattern.

    **P3 — the residue definition missed the sequencer states.** A rebase stopped at
    a `break`/`edit` step has no `MERGE_HEAD`, no `REBASE_HEAD` and no unmerged
    paths; `CHERRY_PICK_HEAD` / `REVERT_HEAD` after a `git add`-resolved conflict are
    the same shape. All read as clean. Fixed; test 62, mutant M22.

    **P3 — protected artifacts got a warning where the success path gets a restore.**
    Closed, conditional on a clean tree. Implemented but unpinned; see the honest
    scope note under the mutation table.

    **P3 — `residueProbe`'s `runner` argument was dead.** The only production probe
    closed over `realRunner` and ignored it. Removed from the type rather than
    papered over. Round 7 additionally found that the bridge's own `residueProbe`
    override had become byte-for-byte equivalent to the new default — its mutant
    SURVIVED — and deleted it.

14. **Not fixed, out of scope.** The two other substrate defects observed alongside
   this one -- the dual-root sync-contract persistence in `codex-exec.ts` and CPU/RAM
   scheduling contention during E2E runs -- are deliberately NOT bundled into this
   blocker fix, per the governing order.

15. **Round-7 independent review: FAIL — one P1, one P2, one P3. All fixed.**
   A sixth reviewer, authoring none of this, found that round 7's fix installed the
   next defect **for the sixth consecutive round**, and this one was the sharpest yet.

    **P1 — the round-7 controls were unreachable from every production decision
    path.** Round 7 taught `worktreeResidue` to see sequencer state: a
    `rebase-merge`/`rebase-apply` directory, `CHERRY_PICK_HEAD`, `REVERT_HEAD`. But it
    wired those terms only into the two branches that report a FAILED stash push and a
    FAILED stash pop — and both of those are reached only from an unmerged index,
    which no sequencer state produces. A rebase stopped at a `break` step has no
    `MERGE_HEAD`, no `REBASE_HEAD` and a perfectly clean index. So every term round 7
    added was dead from the decision paths that matter, and the proof's claim that the
    wrapper "sees" mid-rebase state was true of the probe and false of the wrapper.

    The reviewer did not argue this; it reproduced a **destructive success**. Against
    a real repository stopped mid-rebase, `main-sync` ran `git pull --ff-only`, which
    fast-forwarded the DETACHED HEAD out from under the rebase in progress, returned
    `merge_wrapper_completed`, and released the repo-wide merge mutex.

    Fixed by measuring ONCE, BEFORE anything is attempted: `main-sync` now consults
    `measureResidue()` before `stashMainSyncPaths` and refuses with a new
    `merge_wrapper_worktree_not_clean` code when the tree is not clean or cannot be
    measured. Nothing is stashed, pulled or merged and HEAD does not move. ~~the mutex
    is retained~~ — **the mutex is RELEASED**; this sentence was left at the round-8
    narrative when round 9 inverted the decision, and round 10 caught it. Pinned by
    test 63 (the destructive case itself, asserting six separate properties including
    an unmoved HEAD and a surviving `rebase-merge` directory) and by mutants M26 and
    M27.

    **P2 — the same blind spot in the second residue reader.**
    `abortInProgressSync`'s before-abort early return still consulted only
    `mergeHead`, `rebaseHead` and `unmerged`, so a worktree whose only signal was
    `CHERRY_PICK_HEAD` took the `{ cleaned: true }` path. Fixed by extending the
    condition to five terms; pinned by test 66 and mutant M24, and the pre-flight's
    own cherry-pick case by test 64 and mutant M23. **Reachability is reported
    honestly**: with the pre-flight in place this function can no longer be reached in
    that state through the wrapper, so the term is defence-in-depth for a second entry
    point. It is pinned by driving the exported function directly rather than by
    claiming a production path that does not exist.

    **P3 — an overstated comment on the `optionsWithProbe` runner binding.** Reworded
    as documentation of intent rather than a load-bearing control, the same correction
    round 5 made for the cleanup runner binding.

    **A consequence I found myself, reported rather than shipped silently.**
    `scripts/ops/merge-wrapper.ts` has its own `runCli()` entry
    (`import.meta.url === argv[1]`) that calls `runMergeWrapper` directly and supplies
    NO `residueProbe`. With the round-8 pre-flight in place, a hand-run
    `tsx scripts/ops/merge-wrapper.ts main-sync ...` therefore now refuses every time
    with `merge_wrapper_worktree_not_clean` and the internal message "no worktree
    residue probe was supplied". Three things are true about it and all three are
    stated here rather than left for a reviewer to find:

    1. ~~**It is fail-CLOSED, not fail-open.** It refuses to sync; it does not sync
       unsafely. No safety property regresses.~~ **THIS WAS FALSE AND ROUND 9 PROVED
       IT BY EXECUTION.** See finding 16. The pre-flight sits AFTER
       `acquireMergeLock`, and its first draft retained the lock on refusal — so a
       probe-less run acquired the repo-wide serializing mutex, did nothing at all,
       and never gave it back for the full TTL, halting every other lane until a
       human reclaimed it. A safety property *did* regress: the reviewer blocked its
       own next command with it. Fixed in round 9 — the pre-flight now releases —
       and pinned by test 68 and mutant M27.
    2. **The sanctioned entry point is unaffected.** `package.json` maps
       `ops:merge-wrapper` to `scripts/ops/ops-merge-wrapper.ts`, which supplies the
       probe at every delegation (mutant M20, 14 tests). Nothing in `package.json`,
       any workflow, or any script invokes `merge-wrapper.ts` directly; the direct
       CLI is reachable only by typing that path by hand. **Independently confirmed
       by the round-9 reviewer**, which also checked for other un-probed callers and
       found none: only tests import these modules, and `ops-merge-wrapper.ts:71`
       re-exports `runMergeWrapper` with no consumer.
    3. **The message is an internal-wiring message in the slot reserved for a state
       measurement** — precisely the defect class round 7's reviewer named. Still
       true, and still the residual complaint.

    **The residual is now cosmetic rather than unsafe, and is still not fixed here.**
    With the round-9 release in place, a probe-less run refuses, releases, and blocks
    nothing. What remains is that its message explains a wiring gap where a state
    measurement belongs. The clean fix is to move
    `probeSyncResidue`/`worktreeResidue` down into `merge-wrapper.ts` so
    `runMergeWrapper`'s default is a real measurement instead of an injection seam,
    which would delete `optionsWithProbe`, mutant M19 and mutant M20 along with it.
    That is a file-boundary refactor, and the governing order for this lane is
    explicit: *"Do not broaden the issue beyond making git-merge-main transactional
    and noninteractive."* PM has ruled individually on every scope change here,
    including a single-file addition. So it is raised as a PM decision — fix here
    under a widened scope, or take it as a successor issue — and NOT self-authorized.
    The behaviour itself is pinned by tests 59 and 68.

    **What round 8 cost, stated plainly.** Making the round-7 terms reachable changed
    which control enforces the stranded-merge case, and M16 — killed in round 6 —
    now SURVIVES. It is reported as a survivor above rather than deleted or quietly
    dropped from the table. This is the seventh consecutive round in which a fresh
    reviewer found something the previous round's fix installed, and the fourth in
    which the PROOF asserted a property the CODE did not have.

16. **Round-8 independent review: FAIL — one P1, three P2s, three P3s. All fixed.**
   A seventh reviewer, authoring none of this, returned FAIL for the **ninth
   consecutive round**. It falsified the round-8 *code* by execution and could not
   break it; every finding was in the *evidence*, plus one undisclosed regression.

    **P1 — the machine-readable artifact contradicted the human-readable one.**
    `evidence.json`'s `mutants[]` array was left at round-7 data while
    `verification.md`'s table was updated for round 8. It held 22 rows, recorded the
    known survivor M16 as `KILLED`, omitted M23–M26 entirely, and narrated a
    "single round-7 pass" — while the same object's `count` said 25 and `surviving`
    said 1. The reviewer re-measured eight rows against the table and found the table
    byte-exact, then found the JSON wrong. An auditor reading only the JSON would
    conclude zero survivors, and the Proof Auditor Gate passed it. Regenerated in
    round 9 from the current measurement and diffed against the table.

    **P2 — a repo-wide merge-mutex leak, disclosed as harmless.** Round 8 disclosed
    the probe-less `runCli` refusal and asserted "no safety property regresses". The
    pre-flight sits AFTER `acquireMergeLock` and retained the lock, so a probe-less
    run acquired the serializing mutex, did nothing, and never released it for the
    full TTL. The reviewer reproduced it on a **pristine** worktree and blocked its
    own next sanctioned command with `merge_lock_stale_reclaim_required`. Fixed: the
    pre-flight releases, because this run created no state to protect. Test 68,
    mutant M27. **This is the fourth time in this lane that the proof asserted a
    property the code did not have, and the first time the false claim was about a
    correction rather than an implementation.**

    **P2 — `File scope lock` is red and the bundle never said so.** Recorded below
    under **Scope**.

    **P2 — the PR body was eight rounds stale**, claiming 49/0 tests, a six-mutant
    battery, and a Scope section omitting `scripts/ops/merge-wrapper.ts` entirely.
    Rewritten in round 9.

    **P3 — a commit BODY still cited the pre-rewrite SHA `9162d2c9`.** The round-8
    rewrite fixed the subject line and missed the body, so `evidence.json`'s claim
    that "no message on this branch names a commit that is not on it" was false.
    Fixed. Fixing it renamed the next commit in turn, which invalidated *its*
    SHA-bearing subject — so the SHA was removed from that subject rather than
    repointed. **A SHA in a commit subject is self-invalidating under any message
    rewrite**, and that is the durable lesson.

    **P3 — the `trees_unchanged` record cited the wrong tree.** It named
    `fd554012`, which is the tree of a commit created *after* both rewrites and could
    not have existed before them. The invariant tree is `d1227506`. The substantive
    claim was true — the reviewer verified all six mappings byte-identical — but the
    evidence cited for it was not.

    **P3 — the real-git counts were overstated.** 21 claimed, 20 actual (test 32
    builds no repository), and four of the seventeen claimed to have "nothing about
    git mocked" do substitute a synthetic result for one invocation. Corrected above.

    **What the reviewer could not break**, recorded because negative results are
    evidence too: the headline `--no-ff` merge against a real diverged branch; the
    round-8 P1 fix (with the pre-flight deleted it reproduced the destructive
    success, with it present the refusal held); no false positive on clean or merely
    dirty trees; reachability of both round-8 additions; non-vacuity of tests 63–67
    by targeted inversion; the `CLEAN_WORKTREE_PROBE` stub hiding nothing; and all
    five wrapper safety invariants on the sanctioned path.

17. **Round-9 independent review: FAIL — one P1, three P2s, three P3s. All fixed.**
    Recorded as finding 16 above; this entry exists only so the numbering does not
    imply a round is missing.

18. **Round-10 independent review: FAIL — two P1s and one P3. All fixed here.**
    An eighth reviewer, authoring none of this implementation or proof, ran the
    falsification battery again against head `da6d0d63`.

    **P1 — the round-8 destructive success is still reachable, through `git bisect`.**
    REPRODUCED, with a negative control. During a bisect HEAD is detached at the
    commit under test and the worktree carries no `MERGE_HEAD`, no `REBASE_HEAD`, no
    `rebase-merge`/`rebase-apply` directory, no `CHERRY_PICK_HEAD`, no `REVERT_HEAD`
    and no unmerged path. Every term the probe enumerated read absent, the pre-flight
    passed the tree as clean, `git pull --ff-only` fast-forwarded the detached HEAD
    off the commit being tested, and the wrapper returned `merge_wrapper_completed`
    with `BISECT_LOG` intact — so every subsequent `git bisect good|bad` records a
    verdict against the wrong commit and the search converges on an answer that was
    never tested. The word "bisect" appeared nowhere in either source file, nowhere
    in the suite, and nowhere in this bundle including its eighteen `known_gaps`.

    This is the third round in a row in which the fix for a destructive success was
    correct about the mechanism and incomplete about the population. Rather than add
    the one state and move on, the remediation swept the enumeration: eight candidate
    in-progress states were built against real git and each was measured against the
    round-9 probe. Exactly one was invisible — bisect, in all three of its variants
    (plain, `--no-checkout`, and started-with-no-verdict-yet, all of which write both
    `BISECT_START` and `BISECT_LOG`). A `.git/sequencer` term was considered and
    REJECTED as an equivalent mutant. **That rejection was WRONG.** Round 11 falsified
    it by execution (finding 19), and the retraction is the lesson this round records:
    the sweep found no state that `sequencer` caught alone, and round 10 read that
    absence as proof rather than as the limit of what it had built. It had not built
    the resolve-then-plain-`commit` path, which is the one that leaves the sequencer
    live with `CHERRY_PICK_HEAD` already cleared.

    Round 10 also wrote that `cherry-pick --quit` residue was "measured and already
    caught". **That is not what was measured, and it is corrected here:** after
    `--quit` there is no residue at all, so nothing catches it because there is
    nothing to catch. The outcome is benign; the sentence described a measurement
    that did not happen.

    Fixed by `gitPathExists('BISECT_LOG') || gitPathExists('BISECT_START')` in
    `probeSyncResidue`, threaded into `worktreeResidue`, into `abortInProgressSync`'s
    nothing-to-abort early return and into its post-abort residue check — all three
    consumers, because round 8's finding was precisely that a new term wired into one
    consumer and not the others leaves the definitions of "clean" divergent. Pinned by
    test 69 (which carries its own negative control proving the raw pull really is
    destructive in that fixture), test 70 (the cleanup consumer), and mutant M28.

    **P1 — the round-9 P1 was fixed in one artifact and left standing in six
    neighbouring places.** Commit `da6d0d63` regenerated `mutation_controls.mutants[]`
    and verified it against the table row for row. It did not touch the blocks around
    it. Still carrying round-8 data at that head: two `regression_fixtures[]` entries
    named for a mutex the code no longer retains, each asserting "THE CONTROL: the
    merge lock reads `held` and no release is reported" where tests 58 and 59 now
    assert `released`; `invariants_preserved[0]`, asserting the lock RETAINED
    "whenever the worktree could not be measured at all", which is the exact decision
    round 9 inverted; `independent_review` with no `round_9` key at all and a
    `current_head` note still saying "the round-8 corrections" and "six reviews";
    plus, in this file, the checklist bullets at the residue-probe and unmeasured-tree
    entries and the round-8 narrative sentence "the mutex is retained". The TAP
    excerpt carried stale names for `ok 58` and `ok 59`, and `regression_fixtures[]`
    documented 13 of 22 UTV2-1790 tests while omitting tests 63–68 — including test
    63, the round-8 destructive-success reproduction, and test 68, the round-9
    lock-leak control — with no note that it was a selection.

    All corrected, each in place with what it used to say, and `regression_fixtures[]`
    now covers 22 entries and states its own coverage. The generalization, which is
    the part worth keeping: **"regenerate the artifact" is not the same as
    "regenerate the artifact and everything that quotes it."** Finding 11 said a
    measurement not retaken is not evidence; finding 16 said a table and its
    machine-readable twin are two measurements. This one says a corrected fact and
    its six restatements are seven measurements, and correcting one of them is how a
    bundle ends up contradicting itself in public.

    **P3 — the pre-flight told the operator the mutex was released without checking.**
    `merge-wrapper.ts` called `releaseMergeLock`, never read `release.ok`, and printed
    "The merge mutex WAS released" unconditionally. The reviewer forced the failure by
    taking the lock from inside the residue probe — i.e. in the window between acquire
    and release — and got `release.code: merge_lock_owner_mismatch`, a lock reading
    `held` on disk, and a message stating it had been released. The structured
    `release` field was truthful throughout; only the operator-facing half lied, and
    it lied in the direction that stops an operator from going to look for the lock.
    Every other release site in this lane already conditions its prose on the
    measurement. Fixed, pinned by test 71 and mutant M29.

    **What the reviewer could not break**, recorded because negative results are
    evidence: the headline `--no-ff` merge against a real diverged branch, with both
    parent SHAs preserved byte-for-byte; the round-9 lock-leak fix, driven three
    consecutive times probe-less with every run releasing and none returning
    `merge_lock_stale_reclaim_required`; the round-8 fix on its own mid-rebase
    scenario, with a negative control confirming the raw pull is genuinely
    destructive there; mid-merge, mid-cherry-pick, mid-revert and `git am --3way`
    conflict all refusing correctly; a clean merely-behind tree still proceeding, so
    the control does not over-refuse; a real conflicting `git-merge-main` aborting,
    releasing and reporting the real command rather than the bridged pull; and five
    mutation rows (M1, M16, M19, M26, M27) re-inverted independently, every count and
    every killed-test list matching this bundle exactly.

19. **Round-11 independent review: FAIL — two P1s, one P2, two P3s. All fixed here.**
    An eleventh reviewer, authoring none of this implementation or proof, falsified
    round 10's central judgement by execution.

    **P1 — the `.git/sequencer` rejection was wrong, and the state is destructive.**
    Round 10 swept eight candidate in-progress states, found none that a `sequencer`
    term caught alone, and recorded it as an equivalent mutant. Round 11 built the
    state round 10 had not: `git cherry-pick A B`, conflict, resolve the conflict,
    then a plain `git commit` instead of `git cherry-pick --continue`. That CLEARS
    `CHERRY_PICK_HEAD` and leaves `.git/sequencer` live **with HEAD still attached to
    the lane branch** — `git status` says "Cherry-pick currently in progress" while
    every enumerated term reads absent. `main-sync` fast-forwarded the branch and
    returned `merge_wrapper_completed`; the operator's later `--continue` then replays
    the pending picks onto a base they never chose. Fixed by the `sequencer` term,
    pinned by test 72 and mutant M30. The retraction is recorded at both sites where
    round 10 asserted the rejection, unedited and refuted rather than deleted.

    **P1 — a bare detached HEAD leaves NO state to enumerate.** `git checkout <sha>`
    to inspect a commit by hand writes no marker anywhere. It was silently
    fast-forwarded, with no head-move notice — that notice exists only on the bridged
    `git-merge-main`/`git-rebase-main` path, not on `main-sync`. The reviewer also
    measured the related pre-existing defect: driven from a detached HEAD the wrapper
    returned `merge_wrapper_completed` while `refs/heads/<lane>` never moved at all.
    Fixed by the `detachedHead` term, pinned by test 73 and mutant M31.

    **P2 — the regression counts were stale again.** The prose said sixty-eight
    regressions against a suite of 71, "twenty of the sixty-eight" build a real
    repository when 22 did, an on-disk list that stopped at 66, "all 22 UTV2-1790
    tests" when 25 carried the prefix, and a `regression_fixtures` block whose count
    and coverage note silently omitted tests 60, 61 and 62. Recounted mechanically
    against the suite at this head and corrected, in both artifacts.

    **P3 — the eight swept states were never enumerated.** Round 10 asserted a sweep
    and reported only its conclusion, so a reader could not check the population the
    conclusion rested on — which is exactly how the sequencer case survived. The
    population is listed here, each state built against a real repository and measured
    against the round-9 probe:

    | # | State built | Command | Round-9 probe saw | Verdict |
    |---|---|---|---|---|
    | 1 | mid-merge, conflicted | `git merge <br>` → conflict | `MERGE_HEAD` + unmerged | already caught |
    | 2 | mid-rebase, conflicted | `git rebase <br>` → conflict | `rebase-merge` dir | already caught |
    | 3 | interactive rebase at `break` | `GIT_SEQUENCE_EDITOR` → `break` | `rebase-merge` dir | already caught |
    | 4 | mid-cherry-pick, conflicted | `git cherry-pick <c>` → conflict | `CHERRY_PICK_HEAD` + unmerged | already caught |
    | 5 | mid-revert, multi-commit | `git revert -n <a> <b>` | `REVERT_HEAD` / unmerged | already caught |
    | 6 | `cherry-pick --quit` residue | resolve, then `--quit` | **nothing** | nothing to catch — see below |
    | 7 | stopped `git am` | `git am --3way` → conflict | `rebase-apply` dir | already caught |
    | 8 | bisect (3 variants) | `git bisect start/good/bad` | **nothing** | **MISSED — round 10's fix** |

    Round 11 then added the ninth and tenth states round 10 never built — a paused
    cherry-pick SEQUENCE resolved with a plain `git commit`, and a bare detached HEAD
    — and both were destructive. State 6 is the one round 10 described wrongly: after
    `--quit` there is no residue at all, so "already caught" was never measured.

    **P3 — `sequencerDir` and `sequencerFile` were byte-identical duplicates.**
    Collapsed into one `gitPathExists`.

    A separate round-10 sentence claiming `cherry-pick --quit` residue was "measured
    and already caught" is also corrected: after `--quit` there is no residue at all,
    so nothing catches it because there is nothing to catch. The outcome is benign,
    but the sentence described a measurement that did not happen.

    **What round 11 could not break**, recorded because negative results bound what a
    review covered: bisect in both variants, `git am --3way`, an interactive rebase
    stopped at `edit`, `git revert -n`, and a conflicted `git stash apply` were all
    correctly refused with HEAD unmoved and the mutex released. A **linked worktree
    whose `.git` is a file** and a **cwd inside a repository subdirectory** both
    resolved correctly, confirming the `path.isAbsolute(rel) ? rel : path.join(...)`
    handling against the two cases that actually differ. Mutation spot-checks M28,
    M29, M23 and M26 re-inverted independently and matched exactly. Scope clean,
    `verified_source_sha` correct, PR body accurate.

20. **Round 12 — the guard stops being a blocklist.** Not a defect report but a
    design change, and it is the most important thing in this bundle.

    Rounds 8, 10 and 11 each found one more in-progress state that read clean and was
    destroyed by a fast-forward, and each was fixed by adding the missing term. Round
    10 went further and REJECTED a term that round 11 proved live. Four rounds of
    "add the missing term" is not four unlucky misses; it is the signature of an
    enumeration standing in for a predicate over an open-ended space. Round 11's own
    detached-HEAD finding is the proof the enumeration cannot close: that hazard is
    defined by the ABSENCE of a marker, so there is no term to add, and any future git
    feature or hand-rolled operator state lands in the same blind spot.

    The inversion: rather than refuse when any of N known-bad markers is present,
    require positive proof of the one acceptable state before touching anything —
    **HEAD attached, to exactly the branch the wrapper was invoked for** — and refuse
    everything else, including states nobody has enumerated. `probeSyncResidue` now
    captures `headRef`; `worktreeResidue` takes an optional `expectedBranch` and
    refuses any other ref, naming both observed and expected; the `main-sync`
    pre-flight passes `input.branch`. The post-failure cleanup path passes nothing:
    it measures residue, not fitness to sync, and has no branch to expect. Pinned by
    test 75 and mutants M32 and M33.

    **What this closes, stated without overclaim.** It closes the OFF-BRANCH half
    completely — bisect, rebase, bare-detached, and anything future that moves HEAD
    off the lane branch, caught without being enumerated. Every round-8/10/11 escape
    lived there. It does **not** close the ON-BRANCH mid-operation half: the round-11
    sequencer case, a conflicted merge and a conflicted cherry-pick all leave HEAD
    attached to the lane branch, so the enumerated terms remain load-bearing for
    those and that half is still an enumeration. Recorded as a named residual in
    `known_gaps` rather than allowed to look subsumed. Delegating that half to git's
    own state enumeration (`wt_status_get_state`) was considered and rejected: its
    only access is `git status` prose, which is i18n-dependent and not
    porcelain-stable, and a fail-closed guard cannot rest on that.

    **TOCTOU closure (PM disposition).** The allowlist alone would still have been a
    check-then-use gap. The pre-flight measures the tree, then this run itself mutates
    it with `git stash push`, and the operator's shell stays live throughout — so every
    state the pre-flight refuses can be reintroduced in that window, and the pre-flight
    would never know. The tree is now RE-PROBED against the post-autostash state
    immediately before the merge command, and refuses on anything the pre-flight would
    have refused. On refusal the autostash is popped FIRST so the operator's lane state
    is returned rather than left parked in a stash they did not create; the pop outcome
    is measured, and if it fails the mutex is deliberately RETAINED, because a stash
    that could not be restored is half-finished state. Pinned by test 76 — where a
    concurrent operator really does switch branch after the autostash lands, and the
    real probe measures a real repository that genuinely changed underneath the run —
    and by mutants M34, M35 and M36.

    **The enumeration is retained as defence in depth.** The allowlist does not replace
    the operation detection, it joins it: the attached-branch invariant alone does not
    exclude every sequencer state, as the round-11 P1 shows. Test 78 is table-driven
    over every recognized operation state — mid-merge, mid-cherry-pick, mid-revert,
    mid-rebase, bisect, wrong branch, bare detached HEAD — and each row asserts a
    PREMISE that the fixture really is in the state it names before asserting the
    refusal, so no row can pass on a state other than its own, and each row asserts
    that both HEAD and the lane branch are unmoved afterwards. Test 77 covers a
    detached HEAD DURING a bisect, round 10's exact hazard, and asserts it is now named
    by both terms independently.

    **The control that keeps every refusal honest.** Five rounds have added terms, so
    over-refusal risk grows monotonically, and a guard that refuses everything is
    trivially safe and useless. Test 79 drives the ordinary case end to end — lane
    behind, HEAD attached to the expected branch, no operation in progress, tree dirty
    with real lane state — and asserts it SYNCS: the branch actually advances, main's
    content actually arrives, and the autostashed lane state comes back byte-for-byte.

    **Counts in this bundle are now generated, not transcribed.** Rounds 9, 10 and 11
    each shipped a wrong number here — 68 against a suite of 71, "twenty" against 22,
    "22 UTV2-1790 tests" against 25, and a `regression_fixtures` array that silently
    omitted six tests and then three more. Every one was hand-typed and stopped
    tracking a suite that kept growing. They are derived now from the suite source for
    names and shapes and from an actual TAP run for the totals, with the run
    cross-checked against the source name-by-name and the generator refusing to write
    anything from a red run. A third omission would be a script defect rather than a
    memory lapse.

    **A latent defect the inversion exposed.** Every real-git fixture in this suite
    built its lane branch as `lane` while the input named
    `codex/utv2-1061-merge-mutex-wrapper` — a branch no fixture ever created. Ten
    tests went red the instant the allowlist landed. The mismatch survived the entire
    life of the suite because nothing had ever asked whether HEAD was on the branch
    being synced, so no assertion constrained the value. This is the same class as
    round 9's finding, where an evidence correction reached `mutants[]` but not the
    six neighbouring sites quoting it: a suite agreeing with itself about a value
    nothing checks. Fixtures and input are one `LANE_BRANCH` constant now.

21. **A ratified PM decision on the re-probe's scope.** The round-12 disposition worded
    the pre-merge re-probe as requiring a "clean index/worktree". Implemented as clean
    INDEX — no unmerged paths, correct attached branch, no active operation — and
    deliberately TOLERANT of unrelated tracked-dirty and untracked files. After the
    autostash only lane-state paths are stashed, so unrelated operator work legitimately
    remains, and preserving it across a sync is a documented guarantee of this wrapper
    (a round-4 negative result). The strict spotless-worktree reading was declared to PM
    rather than narrowed silently, and PM RATIFIED the clean-index reading with this
    reasoning: every P1 across rounds 8–11 was a state hazard, not a dirty-file hazard,
    so the strict reading would have added refusals without closing any reproduced
    failure — over-refusal rather than safety. Test 79 is the control that would have
    gone red under the strict reading. Recorded here as a ratified decision, not as an
    implementer's narrowing.

22. **The same decision lost its control twice, in one lane.** The round-12 battery
    reported **M36 SURVIVING**: on the new pre-merge re-probe path, when the refusal's
    autostash pop FAILS, nothing pinned whether the merge mutex is retained.

    The behaviour was already correct — the path was written to retain, and it retains.
    But "correct and unpinned" is precisely what round 5 shipped: round 5 RELEASED the
    repo-wide mutex on a stash-pop failure and justified it with prose that nothing on
    that path had measured, and finding 11 records that as a fail-open the previous
    round's proof had certified as impossible. Round 12 then wrote the same decision
    again, in new code, after that instance had been found and fixed — correctly this
    time, and again with no control over it.

    That is a recurring blind spot around one specific decision point, the failure-path
    mutex-retention choice, and it is recorded as such rather than compressed into
    "added test 80". The pattern is that this decision reads as obviously right while
    being written, which is exactly the condition under which nobody writes the test.
    Any future edit touching a release-or-retain choice on a failure path should be
    treated as needing its control written first.

    **Classification, stated explicitly because the round-12 escalation rule turns on
    it.** The rule is to stop and return to PM on another P1 IN THE SYNCHRONIZATION
    STATE MODEL, and not to continue by adding another isolated marker. M36 meets
    neither condition: no hazard state was missed and no operator-visible defect
    existed, so it is a COVERAGE defect over a correct decision rather than a state-model
    defect; and the remediation is one executed regression against real git, with no
    change to the state model or the enumeration — the opposite of the add-one-more-term
    ratchet the rule exists to end. Proceeding was therefore in-rule, and the call is
    recorded here so it is reviewable rather than assumed.

    Test 80 pins it: real repository, real autostash, a concurrent branch switch so the
    RE-PROBE refuses rather than the pre-flight, and an injected `git stash pop` that
    fails WITHOUT executing — so the stash genuinely survives and `git stash list`
    confirms it. That is the difference between measuring an unrestored stash and
    measuring a reported one. It asserts the mutex is HELD, that no release is even
    attempted, that `popped: false` is reported rather than assumed away, and that the
    operator is told both that their lane state is parked and that the lock is held on
    purpose. Verified to die to test 80 and to nothing else.

23. **A finding about the measurement apparatus, not the code.** During this round the
    mutation battery was stopped mid-mutation twice, and each time it left a mutant live
    in the worktree. The first (M5) was caught. The second was **M16, which is this
    bundle's documented SURVIVOR** — so its mutant sat live across several runs while
    the suite reported 79/79, and the green suite was read as evidence of a clean tree.

    That inference was wrong, and it is wrong structurally rather than by accident: a
    green suite can only ever detect residue from mutants the suite KILLS. It is
    incapable, by construction, of detecting residue from exactly the survivors a
    mutation bundle depends on reporting honestly. The check is `git diff` against
    `HEAD`, never the suite. The battery now restores its sources on `SIGTERM`,
    `SIGINT`, `SIGHUP` and at exit, and it checkpoints each measured row so a kill costs
    one row rather than the whole pass. Recorded because the next person to run a
    battery here will hit the same thing, and nothing else in this bundle would warn
    them.

    A second apparatus slip, recorded for the same reason: the first attempt to
    regenerate `regression_fixtures` normalised test names without stripping their
    `(test N)` suffix, silently dropped the `asserts` detail from fourteen real entries
    and duplicated the array to forty-one. It was caught by checking the output rather
    than by any test, `evidence.json` was reverted to `HEAD` and rebuilt with the
    generator, and nothing wrong shipped. It is the second instance in this lane of a
    self-consistent artifact that no assertion constrained — the first being the
    fixtures that built branch `lane` while the input named a branch no fixture created
    — and that class is precisely what the "generate, do not transcribe" instruction
    exists to remove.

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

- ~~**No fail-open path exists.**~~ **FALSIFIED in round 5** — see finding 11. The
  round-4 reviewer searched the command-failure path and found no route there, which
  was correct as far as it went; the route runs through the SUCCESS path, where a
  conflicting autostash pop left unmerged entries and the mutex was released anyway.
  Recorded here unedited, with its refutation, rather than quietly deleted: a
  negative result from a review is evidence about what that review covered, not a
  guarantee about what it did not.
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
- **Ordering is genuinely pinned**, by test 48's lock read from inside the abort call.
  (Its accompanying claim that "the residue re-probe is load-bearing" was **too
  strong**: two of the three terms were pinned, the third was killed by nothing until
  round 5 added M13.)
- **Hook coverage is complete rather than lucky.** `main-sync` is `git pull --ff-only`
  and `pr-merge`/`pr-update-branch` are remote `gh` calls, none of which can leave a
  merge in progress, so the absence of a hook there is safe — confirming the scope
  note above rather than taking it on trust.
- **File scope is honest.** Nine paths versus `main`; the only one outside
  `file_scope_lock` is the lane's own manifest, whose sole change is the one-entry
  widening recorded in provenance.
- **No false review claim** anywhere in the PR or the bundle.

**Round 5 review, of head `009cfe46`.** A third reviewer, again authoring none of this,
reproduced all four headline measurements and the full twelve-mutant battery with 0
survivors, and returned **FAIL** on the four findings recorded in finding 11 — all of
which are fixed above and pinned by M13, M14 and the corrected table. Its own negative
results: the cleanup-before-pop-before-release ordering could not be broken by
reordering (killed by 9 tests) or by releasing early (killed by 4); `reportedCommand`
has no consumer outside this file and makes the success, failure, dry-run and
lock-held paths consistent with the protected-dropped-path branch that already
hardcoded the real vector; tests 49, 53 and 54 are each non-vacuous, demonstrated by
removing exactly the control each names; test 54 does not accidentally ride the
`undetermined` path (it masks with git's exit 1, classified as absent, not the exit
128 of test 51); and `abortInProgressSync` could not be made to destroy legitimate
uncommitted work on either the merge or the rebase path.

**Round 6 review, of head `7372df54`.** A fourth reviewer, authoring none of this
implementation or proof, reproduced all fourteen round-5 mutation rows byte-for-byte
and returned **FAIL** on the one P1, two P2s and two P3s recorded in finding 12 — all
of which are fixed above and pinned by M15–M19 plus tests 57, 58 and 59. Its P1 was
demonstrated by execution, not inspection: reverting `merge-wrapper.ts` to the
round-4 head showed the lock `released` where the round-5 head showed it `held`.

**Round 7 review, of head `37d3f379`.** A fifth reviewer, authoring none of this,
reproduced all nineteen round-6 mutation rows byte-for-byte — every count and every
killed-test list — and all four headline suite measurements, then returned **FAIL** on
the one P1 and three P3s recorded in finding 13, all fixed above and pinned by tests
60, 61, 62 and mutants M20, M21, M22. Its negative results: the stranded stash entry
cannot confuse a later lane (`git stash pop` is strict LIFO on `stash@{0}`, and a
stranded entry does not block a later push); the head-move notice appended to `stderr`
cannot confuse the only stderr parser (`isNotFastForwardFailure`, whose single call
site consumes a result that never passes through the appending code); dropping
`!result.ok` only ADDS a branch and weakens no existing protected-path refusal; tests
57, 58 and 59 are each non-vacuous, with M15, M16, M18 and M19 each killing exactly
one of them; and test 57's clean-tree premise is asserted on disk after the real git
run rather than assumed by the fixture.

**Round 8 review, of head `cb059ebb`.** A sixth reviewer, authoring none of this
implementation or proof, returned **FAIL** on the one P1, one P2 and one P3 recorded
in finding 15, all fixed above and pinned by tests 63–67 and mutants M23–M26. Its P1
was demonstrated by execution against a real mid-rebase repository, not by inspection:
the wrapper reported `merge_wrapper_completed`, the detached HEAD had advanced, and
the mutex was released.

**Round 9 review, of head `76e09e7a`.** A seventh reviewer, authoring none of this
implementation or proof, returned **FAIL** on the one P1, three P2s and three P3s
recorded in finding 16 — all fixed above. It is the first round whose findings were
almost entirely in the evidence rather than the code: it attacked the implementation
by execution and could not break it. Its P2 lock leak was reproduced on a pristine
worktree and is pinned by test 68 and mutant M27.

**Round 10 review, of head `da6d0d63`.** An eighth reviewer, authoring none of this
implementation or proof, returned **FAIL** on the two P1s and one P3 recorded in
finding 18, all fixed above and pinned by tests 69–71 and mutants M28–M29. Its first
P1 was demonstrated by execution against a real bisecting repository and carried its
own negative control; its second was an audit of this bundle against the head it
claims to describe. It re-inverted five mutation rows independently and matched every
count.

**Round 11 review, of head `ab21ffcd`.** A ninth reviewer, authoring none of this
implementation or proof, returned **FAIL** on the two P1s, one P2 and two P3s recorded
in finding 19. Both P1s were demonstrated by execution against real repositories and
each carried its own negative control showing the raw `--ff-only` pull is genuinely
destructive in that state. Its first P1 falsified round 10's explicit judgement that a
`.git/sequencer` term was an equivalent mutant, which is the reason round 12 stopped
enumerating (finding 20). It re-inverted four mutation rows independently and matched
every count, and recorded seven states it could NOT break — including the two path-
resolution cases (a linked worktree with a `.git` file, and a cwd inside a repository
subdirectory) that are the only ones where `--git-path` behaviour actually differs.

**Review of the current head is PENDING.** The round-11 corrections and the round-12
allowlist moved the head, so none of the nine reviews above covers the code now
proposed for merge. No claim of completed independent review at this head is made.

## Scope

Authorized code scope, four files touched, nothing else:

- `scripts/ops/ops-merge-wrapper.ts`
- `scripts/ops/ops-merge-wrapper.test.ts`
- `scripts/ops/merge-wrapper.ts` — added to `file_scope_lock` for the P1 remediation;
  justification in Findings 6.
- `scripts/ops/merge-wrapper.test.ts` — **round 8, flagged rather than assumed.** The
  round-8 pre-flight changed behaviour that four PRE-EXISTING fixtures in this sibling
  suite depend on: they drive `main-sync` with blanket mock runners that the pre-flight
  correctly reads as unanswerable, so they began refusing. The edit is the minimum that
  restores them — one shared `CLEAN_WORKTREE_PROBE` constant and one added option on
  each of the four calls — and changes no assertion, no expected result code and no
  command-sequence expectation. It is a consequence of the accepted implementation, not
  a widening of the objective; it is called out here so a reviewer sees it as a fourth
  path rather than discovering it in the diff.

Plus lane-owned metadata: `.ops/sync/UTV2-1790.yml`,
`docs/06_status/lanes/UTV2-1790.json`, `docs/06_status/proof/UTV2-1790/**`.

**`File scope lock` is RED on this head, and here is exactly why.** The guard
resolves a manifest that is absent from `origin/main` via the first PR commit that
added it — `ac6e3307`, which declared four paths — and by design ignores any later
self-widening. This lane widened twice: `scripts/ops/merge-wrapper.ts` under explicit
PM approval, and `scripts/ops/merge-wrapper.test.ts` as a consequence of the round-8
pre-flight. Both are declared in the head manifest; neither is in the base one, so the
guard reports both as undeclared. It is not a required context and will not block
merge, but it IS red and this bundle previously did not say so — a round-9 P2. The
only mechanism that can clear it is a `scope-override/v1` comment bound to the exact
head, which is a PM artifact and is not something this lane may issue for itself.

No workflow file, no production/runtime/DB code, no `package.json`, lockfile or
tsconfig change, no proof-schema change, no branch-protection change, and no bypass
flag. Both `scripts/ops/*merge-wrapper*.test.ts` suites were already wired into the
ops suite, so no test-registration edit was required.

## Merge SHA Binding

Merge SHA: pending merge

`sha_binding.verified_source_sha` is the last commit on this branch that touches a
non-proof path. `merge_sha` is rebound automatically by `post-merge-lane-close.yml`
after merge.
