# PROOF: UTV2-1785

MERGE_SHA: 69b69d528b3919c072e529d4e23a5490690cb1c4

Fix the pre-proof validator hook's file-selection semantics so it validates the
files a commit actually authors, instead of every path `git diff --cached`
reports. On a merge commit the staged set includes every file inherited from
the incoming parent, so a historical proof bundle that predates the current
schema blocked an unrelated lane sync (PR #1453, UTV2-1745). The lane fixes the
selection, and hardens the surrounding validation, without weakening any check
and without touching UTV2-1729's evidence.

**Lane verdict: the hook now blocks strictly more real defects than before, and
no fewer. Every relaxation is bounded to content the commit inherits unchanged.**

## Verification

ASSERTIONS:

- [x] Inherited-unchanged content is not validated. A merge that carries a
      pre-existing invalid `evidence.json` in from the incoming parent, with no
      post-merge edit, commits cleanly (exit 0). This is the PR #1453 incident.
- [x] Inherited content that IS edited after the merge is still validated. The
      same fixture, with the old proof rewritten and staged, is blocked (exit 2)
      naming that exact path.
- [x] A conflict resolved to bytes exactly equal to one parent is still authored
      and still validated. Proven for the incoming-parent (`--theirs`) case: the
      resolution bytes equal `MERGE_HEAD`'s blob, and the hook still blocks.
      Combined-diff identity alone would have missed this; the hook additionally
      diffs the index against `git merge-tree`'s automatic merge result, which
      contains conflict markers for that path, so the resolution is detected.
- [x] Deleting or renaming an inherited proof file does not evade validation.
      Both are reported as `proof file is staged as deleted or unavailable`.
- [x] Ordinary non-merge commits are unchanged: an invalid staged proof is
      blocked exactly as before.
- [x] Validation reads the STAGED blob (`git show :path`), not the worktree. A
      valid file left in the worktree over an invalid staged blob no longer
      launders the commit.
- [x] Malformed JSON now fails closed. The previous implementation caught the
      parse exception and `sys.exit(0)`, so unparseable evidence passed. It is
      now reported as `cannot parse evidence: ...`.
- [x] Octopus merges (2+ `MERGE_HEAD` entries) fall back to the union of all
      parent diffs — deliberately conservative, since there is no single
      automatic merge tree to compare against.
- [x] `MERGE_HEAD` is resolved through `git rev-parse --git-dir`, so detection
      works in a linked worktree, where `.git` is a file and the real git dir
      lives under `.git/worktrees/<name>`.
- [x] The hook validated by these tests is the tracked, repo-owned file that
      `.claude/settings.json` actually invokes. There is no generated or local
      `.git/hooks` copy: `.git/hooks` contains only `*.sample` files, and the
      repo has no husky or hook installer.

### Mutation evidence

Two mutation controls prove the new logic is load-bearing rather than
decorative. Each rewrites the shipped hook into a temporary copy, runs the
mutant against the same fixture, and asserts the mutant behaves differently.

1. `PR #1453 regression allows inherited history while the legacy staged-file
   mutation blocks it` — replaces the `# BEGIN/END MERGE-AWARE SELECTION` block
   with the pre-fix `git diff --cached --name-only` selection. On the exact
   incident fixture (a merge carrying an unrelated `package.json` conflict plus
   an inherited invalid proof), the shipped hook exits 0 and the mutant exits 2
   naming `docs/06_status/proof/OLD/evidence.json`. The mutant reproduces the
   incident; the fix removes it.

2. `the indirect-invocation fallback is load-bearing, not decorative` — deletes
   the indirect-invocation fallback block. The mutant exits 0 on
   `bash -c "git commit -m indirect"` with an invalid proof staged; the shipped
   hook exits 2. Without the fallback the gate is bypassable.

### Adversarial review (orchestrator, independent of the executor)

Six bypass vectors were attempted directly against the shipped hook, outside the
test suite, in throwaway git repositories.

| # | Vector | Result |
|---|---|---|
| 1 | Symlink smuggle — stage `evidence.json` as a symlink to an out-of-tree file | BLOCKED (`cannot parse evidence`); the staged blob is the link target string, not JSON |
| 2 | Deeply nested proof path `docs/06_status/proof/A/B/C/evidence.json` | BLOCKED |
| 3 | Proof path containing a space | BLOCKED; selection is NUL-delimited (`-z`) end to end |
| 4 | Resolve a conflicted proof to `MERGE_HEAD` bytes, then delete `.git/MERGE_MSG` to erase the conflict record | BLOCKED; the automatic-merge-tree comparison does not depend on `MERGE_MSG` |
| 5 | Indirect invocation: `bash -c "git commit"`, `sh -c '...'`, `eval "..."` | **INITIALLY BYPASSED — defect found and fixed in this lane. See below.** |
| 6 | Command-spelling variants: `git -c user.name=z commit`, `GIT_AUTHOR_NAME=z git commit`, `cd X && git commit`, `/usr/bin/git --no-pager commit` | BLOCKED |

**Vector 5 was a real regression introduced by the rewrite.** The pre-existing
hook detected commits with a raw substring match (`grep -q 'git commit'`), which
matched inside a quoted wrapper. The rewrite replaced that with `shlex`-based
argv walking, which is more precise for direct invocations but cannot see inside
`bash -c "git commit -m x"` — the whole quoted string is one token whose
basename is not `git`. Measured on the same fixture:

    OLD hook (origin/main):   bash -c "git commit -m x"  -> exit 2  (engaged)
    NEW hook (as returned):   bash -c "git commit -m x"  -> exit 0  (BYPASSED)

The fix keeps the precise tokenizer and adds a fail-closed fallback: if argv
walking finds no `git ... commit`, the raw command is re-checked with a
substring/regex match that is a superset of the legacy behaviour. Detection is
now a strict superset of both implementations — it catches everything the old
hook caught, plus `git -c k=v commit` and `git --no-pager commit`, which the old
substring match missed. Post-fix measurement:

    bash -c "git commit -m x"       -> exit 2   sh -c 'git commit -m x'  -> exit 2
    eval "git commit -m x"          -> exit 2   git commit -m x          -> exit 2
    git -c user.name=z commit -m x  -> exit 2   GIT_AUTHOR_NAME=z git commit -m x -> exit 2

Non-commit commands remain unaffected (`git status`, `git log --oneline -5`,
`pnpm test`, `grep -r commit .` all exit 0).

## Runtime Verification

This is a `governance` lane on the `static` proof profile. It changes an
agent-harness hook and its tests. It issues no database query, performs no
network I/O, and touches no runtime, delivery, or ingestion code. Runtime proof
is therefore the executed behaviour of the hook itself against real git
repositories — the tests spawn actual `git` processes and real merges; nothing
about git is mocked.

### Unit test output

Focused suite, `scripts/ops/proof-check.test.ts`:

```
ok 1 - proof-schema validation fixtures
ok 2 - isProofStale
ok 3 - proof-check file resolution
ok 4 - pre-proof hook ignores invalid evidence inherited unchanged from the incoming parent
ok 5 - pre-proof hook blocks an inherited proof deliberately edited and staged after merge
ok 6 - pre-proof hook validates a conflict resolved to exactly the incoming parent bytes
ok 7 - pre-proof hook retains fail-closed validation for a normal non-merge commit
ok 8 - pre-proof hook blocks malformed JSON rather than treating parse failure as valid
ok 9 - pre-proof hook validates the staged blob instead of an unstaged worktree replacement
ok 10 - pre-proof hook recognizes equivalent git commit command spellings
ok 11 - PR \#1453 regression allows inherited history while the legacy staged-file mutation blocks it
ok 12 - pre-proof hook blocks delete and rename status tricks after a clean merge
ok 13 - pre-proof hook conservatively blocks proof edits hidden in an octopus merge
ok 14 - merge selection resolves MERGE_HEAD through a linked worktree git directory
ok 15 - the configured hook is the tracked repo-owned implementation
ok 16 - pre-proof hook engages on commits invoked indirectly through a shell wrapper
ok 17 - the indirect-invocation fallback is load-bearing, not decorative
# tests 42
# suites 3
# pass 42
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Static verification

    pnpm type-check   -> exit 0 (no output)
    pnpm lint         -> exit 0 (no output)

Full ops suite, `pnpm test:ops`:

```
# suites 20
# pass 2644
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 139931.629697
```

## Findings

1. **Root cause (the lane's subject).** `.claude/hooks/pre-proof-validator.sh`
   selected files with `git diff --cached --name-only`, which on a merge commit
   reports every path inherited from the incoming parent. A historical proof
   bundle written before the current schema therefore blocked an unrelated merge.
   Selection is now: paths differing from *both* parents (combined-diff
   identity), UNION paths differing from git's automatic merge result, UNION
   paths listed in `MERGE_MSG`'s `# Conflicts:` block.

2. **Pre-existing fail-open on unparseable evidence.** The old validator wrapped
   parsing in `try/except` ending in `sys.exit(0)`, so malformed JSON passed
   silently. Now reported as a failure.

3. **Pre-existing time-of-check/time-of-use gap.** The old validator read the
   worktree file while the commit records the index blob. Validation now reads
   `git show :path`.

4. **Regression found in adversarial review and fixed in-lane.** Argv-based
   command detection lost coverage of shell-wrapped commits. See vector 5 above.

5. **Not fixed, recorded as accepted.** A git *alias* for commit (`git ci`) is
   not detected by either implementation. This is unchanged from the pre-fix
   behaviour and out of the authorized scope for this lane.

## Scope

Authorized code scope, both files touched, nothing else:

- `.claude/hooks/pre-proof-validator.sh`
- `scripts/ops/proof-check.test.ts`

Plus lane-owned metadata: `.ops/sync/UTV2-1785.yml`,
`docs/06_status/lanes/UTV2-1785.json`, `docs/06_status/proof/UTV2-1785/**`.

`package.json` is NOT touched. `scripts/ops/proof-check.test.ts` was already
wired into `test:ops`, so no test-registration edit was required — this is what
released the lane from the `package.json` scope deadlock with UTV2-1745.

`docs/06_status/proof/UTV2-1785/.gitkeep`, created by `ops:lane-start`, was
removed because it is not in `file_scope_lock` and would have been scope bleed.

No workflow file, no production/runtime/DB code, no proof-schema change, no
branch-protection change, no bypass flag, and no special-casing of UTV2-1729.
UTV2-1729's evidence is untouched.

## Merge SHA Binding

Merge SHA: pending merge

`sha_binding.verified_source_sha` is the last commit on this branch that touches
a non-proof path. `merge_sha` is rebound automatically by
`post-merge-lane-close.yml` after merge.
