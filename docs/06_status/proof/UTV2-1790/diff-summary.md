# Diff summary — UTV2-1790

MERGE_SHA: 54e03d861d5c53d0990bffd933d5a75f2148f6a5

Two code files. No `package.json`, no lockfile, no tsconfig, no workflow, no
runtime/DB/application code.

| File | Change |
|---|---|
| `scripts/ops/ops-merge-wrapper.ts` | +16 / −1 |
| `scripts/ops/ops-merge-wrapper.test.ts` | +192 / −3 |

## `scripts/ops/ops-merge-wrapper.ts`

One functional line, inside `buildExtendedCommand`'s `git-merge-main` case:

```
-  args: ['merge', '--ff-only', 'origin/main'],
+  args: ['merge', '--no-ff',   'origin/main'],
```

The other 15 added lines are the comment recording why: `--ff-only` cannot merge
a diverged branch by definition, so `main-sync`'s recommended divergence exit
failed on exactly the condition it exists for; `--no-ff` preserves both sides'
commit SHAs and replays nothing; and it is deliberately not a bare `git merge`,
which would fast-forward a merely-behind branch and make the verb's effect depend
on divergence state.

Nothing else in the file changes. All five safety invariants the wrapper is
responsible for live **outside** `buildExtendedCommand` and are therefore
structurally unaffected by a change to the command it returns:

| Invariant | Where it lives | Touched |
|---|---|---|
| merge mutex acquire/release | `runExtendedMergeWrapper` | no |
| protected proof/manifest dropped-path refusal | `PROTECTED_PREFIXES`, `classifyDroppedPaths` | no |
| head-move invalidation reporting | `buildHeadMoveInvalidation`, `renderHeadMoveNotice`, `HEAD_MOVE_REAUTHORIZATION_ORDER` | no |
| `main-sync` divergence refusal (`merge_wrapper_diverged_requires_explicit_sync`) | `runExtendedMergeWrapper` | no |
| raw-command interception | `BLOCKED_RAW_COMMANDS` | no |

## `scripts/ops/ops-merge-wrapper.test.ts`

1. **Truth correction, 3 lines.** Three existing assertions asserted the literal
   `'--ff-only'` for `git-merge-main` and now assert `'--no-ff'`. The four
   remaining `--ff-only` occurrences in the suite belong to `main-sync`'s
   legitimate `git pull --ff-only origin main` and are deliberately unchanged.

2. **Three real-git regressions, +189 lines.** New helpers `git(cwd, ...args)`
   and `withDivergedRepo({conflicting}, run)` build a temporary repository with a
   real `refs/remotes/origin/main` ref and genuine divergence, asserted
   mechanically before the wrapper runs
   (`git rev-list --left-right --count origin/main...HEAD` === `1\t1`). They also
   create `.ops/sync/.gitkeep` and `docs/06_status/lanes/.gitkeep` so the
   wrapper's autostash pathspecs match. The real command runner is used — the
   `runner` option is omitted, so actual `git` subprocesses execute.

   - *merges a genuinely diverged branch* — asserts ok; a merge commit exists;
     `git rev-list --parents -n 1 HEAD` parents equal the two pre-merge SHAs
     byte-for-byte; both original SHAs still resolve; lane-side file preserved and
     main-side content present; mutex released.
   - *fails actionably on a real conflict* — asserts not ok; diagnostic matches
     `/conflict|CONFLICT|Automatic merge failed/u`; mutex released; branch SHA
     unchanged.
   - *records a merge commit when merely behind* — guards against a bare
     `git merge` fast-forwarding.

   `node:child_process`'s `spawnSync` is imported for the helpers; existing
   conventions (`withTempOps`, `BASE`, `readMergeLock`) are reused unchanged.
