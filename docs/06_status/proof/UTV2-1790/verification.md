# PROOF: UTV2-1790

MERGE_SHA: 54e03d861d5c53d0990bffd933d5a75f2148f6a5

`pnpm ops:merge-wrapper main-sync` is the only sanctioned way to bring `origin/main`
into a lane branch. When it detects divergence it refuses and names two explicit
exits, recommending `git-merge-main` because it "preserves history and SHAs".
`git-merge-main` built `git merge --ff-only origin/main`, which cannot merge a
diverged branch by definition. The verb therefore failed on exactly the condition
it exists for, and the only operable exit left was `git-rebase-main`, which rewrites
history, moves the head SHA, and invalidates every head-pinned governance artifact
(pm-verdict, t1-approved evidence, executor-result).

**Lane verdict: `main-sync`'s recommended divergence exit is now operable, and it
preserves commit SHAs on both sides. No wrapper safety invariant is weakened.**

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
- [x] Merge mutex acquisition and release are preserved. The lock file is asserted
      released after the successful merge and after the failing one.
- [x] Actionable failure behaviour is preserved. On a real content conflict the
      wrapper returns not-ok with a diagnostic matching
      `/conflict|CONFLICT|Automatic merge failed/u`, and the branch SHA is unchanged.
- [x] Protected-path refusal is preserved. `classifyDroppedPaths` and
      `PROTECTED_PREFIXES` (including `docs/06_status/proof/`) are untouched and live
      outside `buildExtendedCommand`.
- [x] Head-move invalidation reporting is preserved. `buildHeadMoveInvalidation`,
      `renderHeadMoveNotice` and `HEAD_MOVE_REAUTHORIZATION_ORDER` are untouched.
- [x] The `main-sync` divergence refusal itself is preserved. The wrapper still
      refuses with `merge_wrapper_diverged_requires_explicit_sync` rather than
      silently substituting a rebase; this lane makes the recommended manual exit
      work, it does not restore any automatic substitution.
- [x] `BLOCKED_RAW_COMMANDS` is unchanged, so the raw commands the wrapper exists to
      intercept are still intercepted.

### Mutation evidence

The control is proven load-bearing by inverting it: `--no-ff` was reverted to the
original `--ff-only` and the suite was re-run.

```text
$ # mutation: args ['merge','--no-ff','origin/main'] -> ['merge','--ff-only','origin/main']
$ pnpm exec tsx --test scripts/ops/ops-merge-wrapper.test.ts
not ok 2  - buildExtendedCommand constructs git-merge-main command
not ok 23 - git-merge-main releases the lock after command failure
not ok 27 - git-merge-main completes successfully and releases the lock
not ok 47 - UTV2-1790: git-merge-main merges a genuinely diverged branch (real git)
not ok 48 - UTV2-1790: git-merge-main fails actionably on a real conflict and releases the mutex
not ok 49 - UTV2-1790: --no-ff still records a merge commit when the branch is merely behind
# fail 6
```

Six tests fail on the mutant and all 49 pass on the shipped code, so the assertions
are non-vacuous: they distinguish the fixed behaviour from the defective behaviour.
Critically the three real-git tests (47-49) fail because the merge genuinely does not
happen under `--ff-only`, not merely because a string literal changed — test 2 is the
only command-shape assertion.

## Runtime Verification

This is a `hygiene` lane on the `static` proof profile. It changes an orchestrator
tooling script and its tests. It issues no database query, performs no network I/O,
and touches no runtime, delivery, ingestion or application code. Runtime proof is
therefore the executed behaviour of the wrapper against real git repositories: the
three new regressions spawn actual `git` processes, create real commits on both
sides, and drive the real (non-injected) command runner. Nothing about git is mocked.

### Unit test output

Focused suite, `scripts/ops/ops-merge-wrapper.test.ts`:

```
ok 1  - BLOCKED_RAW_COMMANDS lists every bypassable raw command
ok 2  - buildExtendedCommand constructs git-merge-main command
ok 23 - git-merge-main releases the lock after command failure
ok 27 - git-merge-main completes successfully and releases the lock
ok 47 - UTV2-1790: git-merge-main merges a genuinely diverged branch (real git)
ok 48 - UTV2-1790: git-merge-main fails actionably on a real conflict and releases the mutex
ok 49 - UTV2-1790: --no-ff still records a merge commit when the branch is merely behind
# tests 49
# suites 0
# pass 49
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
  (ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
   ops:automation-coverage-check, env:check, lint, type-check, build, test,
   smart-form verify, verify:commands -- all green)
  98 test suites reported "# fail 0"; 0 suites reported any failure.
  [command-manifest] Verified 14 command definition(s)
  [check-migration-versions] 7 migration file(s) verified -- no duplicate versions.
  [lint-migrations] 6 migration file(s) checked -- no findings.

$ pnpm verify
  pnpm verify = `pnpm verify:static && pnpm test:live-db`.
  verify:static leg: PASS (transcript above).
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
  Changed files: 6
  Rules matched: (none) -- no R-level artifacts required for this diff
```

## Findings

1. **Root cause.** `buildExtendedCommand`'s `git-merge-main` case emitted
   `git merge --ff-only origin/main`. `--ff-only` refuses any merge that is not a
   fast-forward, so the command could only ever succeed on a branch that was merely
   behind -- the one case where `main-sync`'s own `git pull --ff-only origin main`
   already works. On the diverged case, which is the only reason `git-merge-main`
   exists, it always failed.

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

4. **Test-suite truth correction.** Three existing assertions asserted the literal
   `'--ff-only'` for `git-merge-main` and were updated to `'--no-ff'`. The four
   remaining `--ff-only` occurrences in the suite belong to `main-sync`'s legitimate
   `git pull --ff-only origin main` and were deliberately left unchanged.

5. **Not fixed, out of scope.** The two other substrate defects observed alongside
   this one -- the dual-root sync-contract persistence in `codex-exec.ts` and CPU/RAM
   scheduling contention during E2E runs -- are deliberately NOT bundled into this
   blocker fix, per the governing order.

## Scope

Authorized code scope, both files touched, nothing else:

- `scripts/ops/ops-merge-wrapper.ts`
- `scripts/ops/ops-merge-wrapper.test.ts`

Plus lane-owned metadata: `.ops/sync/UTV2-1790.yml`,
`docs/06_status/lanes/UTV2-1790.json`, `docs/06_status/proof/UTV2-1790/**`.

No workflow file, no production/runtime/DB code, no `package.json`, lockfile or
tsconfig change, no proof-schema change, no branch-protection change, and no bypass
flag. `scripts/ops/ops-merge-wrapper.test.ts` was already wired into the ops suite,
so no test-registration edit was required.

## Merge SHA Binding

Merge SHA: pending merge

`sha_binding.verified_source_sha` is the last commit on this branch that touches a
non-proof path. `merge_sha` is rebound automatically by `post-merge-lane-close.yml`
after merge.
