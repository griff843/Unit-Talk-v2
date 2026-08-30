# PROOF: UTV2-1762
MERGE_SHA: f966821f40cd0b6ba72d2bd746b952ed0b6b00aa

Audited scope release: the narrowing-only mechanism `LANE_MANIFEST_SPEC.md`
named as `ops:lane:relock` but never shipped. T2, governance tooling only. No
DB, contract, lifecycle, runtime, or production surface is touched.

## Verification

ASSERTIONS:
- [x] `ops:lane:relock` did not exist before this lane. `grep -rn "relock"` over
      `scripts/`, `package.json`, and `.github/workflows/` returns nothing at
      `origin/main`. The spec named a command that was never implemented, and it
      described widening rather than the narrowing that conflict resolution
      needs. The spec correction says exactly that; it does not claim an
      implementation was removed.
- [x] The operation removes lock entries only. `nextLock` is derived by
      filtering `previousLock`, so no code path can place a string into the
      resulting lock that was not already in the previous one. Naming a path
      that is not already an exact lock entry is refused (`path_not_in_lock`),
      which is what makes widening and replacement unrepresentable rather than
      merely discouraged.
- [x] The operation refuses to run outside the target lane's own worktree
      (`not_in_lane_worktree`) or off its own branch (`branch_mismatch`).
- [x] Every one of issue ID, open PR number, exact expected PR-head SHA,
      expected pre-change `file_scope_lock` hash, released paths, actor, and
      reason is a required input. Omitting any of them fails argument
      validation before any git or GitHub call is made.
- [x] Eighteen refusal conditions are checked, each independently: manifest
      issue / branch / `pr_url` match; GitHub reports the expected open PR at
      the exact expected head; each released path is currently in
      `file_scope_lock`; each released path is absent from the PR's actual
      changed-file list; each released path is absent from staged, unstaged,
      untracked, and unpushed lane work; no concurrent active lane declares the
      path; the resulting lock is valid and nonempty.
- [x] All refusals are collected before returning and the manifest is written
      only on `ok: true`, so a partial failure writes nothing. Asserted with a
      persist spy on a request mixing one valid removal with one unknown path:
      zero writes.
- [x] A successful release appends exactly one `scope_release_history` entry
      containing timestamp, actor, reason, PR number and URL, exact head SHA,
      previous and resulting lock hashes, the exact released paths, and eight
      recorded verification results.
- [x] `files_changed`, issue identity, `status`, `commit_sha`, `pr_url`,
      `branch`, `base_branch`, `tier`, `lane_type`, `expected_proof_paths`,
      `truth_check_history`, `reopen_history`, `started_at`, `heartbeat_at`, and
      `closed_at` are byte-identical across a release. Enforced positively as a
      post-condition — the two manifests are compared with only
      `file_scope_lock` and `scope_release_history` stripped — so a manifest
      field added in future is protected by default rather than forgotten.
      `unexpected_field_mutation` fires if that comparison ever differs.
- [x] The input manifest is not mutated in place.
- [x] `scope_release_history` is append-only and hash-chained. Each entry's
      `previous_lock_hash` must equal the prior entry's `resulting_lock_hash`,
      and the last entry's `resulting_lock_hash` must equal the hash of the
      manifest's current `file_scope_lock`. `validateManifest` enforces this, so
      a lock edited outside this command, an entry describing a lock state the
      manifest does not hold, or an entry claiming a path that is still locked,
      all fail closed.
- [x] `scripts/ci/file-scope-guard.ts` trusts an audited narrowing from the PR
      head and leaves every other manifest-sourced scope change inert:
      unaudited narrowing, a chain that does not start at the baseline hash, a
      chain that does not terminate at the head hash, a removal no entry
      accounts for, a rewritten earlier entry, and any widening are each
      ignored in favour of the base-branch baseline.
- [x] After a release, the releasing lane fails its own scope guard if it
      touches the released path, and the released path no longer blocks another
      lane. Both directions asserted in one test.
- [x] The lock hash duplicated into `file-scope-guard.ts` (which CI extracts and
      runs standalone from the base branch, with no sibling `scripts/ops/` tree
      to import from) agrees with `hashFileScopeLock` in `scripts/ops/shared.ts`
      over a shared fixture set including reordering and `./` prefixes.

## Runtime Verification

EVIDENCE:

### 1. Lane + command surface suite — `scripts/ops/lane-manifest.test.ts`

The scope-release tests live in this file rather than a new
`scripts/ops/scope-release.test.ts`. See "Known gaps" below: the
`executable-wiring` gate rejects any new test file that is not reachable from a
package script or workflow command, and `package.json` is outside this lane's
frozen `file_scope_lock`. The 35 tests are 9 pre-existing lane-manifest tests,
2 for the new subcommand's argument routing, and 24 scope-release tests.

```text
# tests 35
# suites 0
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 2. CI guard suite — `scripts/ci/file-scope-guard.test.ts` (38 pre-existing + 8 new)

```text
# tests 46
# suites 0
# pass 46
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 3. Manifest schema/validation — `scripts/ops/shared.test.ts`

```text
# tests 72
# suites 0
# pass 72
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 4. Mutation control — every refusal proven load-bearing

A green suite proves nothing about a refusal. The harness in
`lane-manifest.test.ts` reads `scripts/ops/scope-release.ts`'s own source, deletes one
`refuse('<code>', ...)` call at a time by paren-balanced rewrite, writes the
mutant beside the original, dynamically imports it, and asserts that the
scenario naming that refusal now gets through. It also asserts, against the
unmutated module, that each scenario produces that refusal **and no other** —
so a refusal that is shadowed, unreachable, or already dead fails the test
rather than passing silently.

All 18 refusals were mutated and all 18 flipped:

```text
no_release_paths            duplicate_release_path      not_in_lane_worktree
branch_mismatch             issue_mismatch              manifest_lane_inactive
pr_url_mismatch             pr_number_mismatch          pr_not_open
head_sha_mismatch           lock_hash_mismatch          path_not_in_lock
path_in_pr_diff             path_in_staged_work         path_in_unstaged_work
path_in_untracked_work      path_in_unpushed_work       concurrent_lane_dependency
```

Mutant files are written and removed inside a `try/finally`; the worktree is
clean afterwards (`ls scripts/ops/ | grep mutant` returns nothing).

### 6. Full suite

```text
pnpm verify
verify:static     PASS (env:check, lint, type-check, build all exit 0)
pnpm type-check   exit 0 (tsc -b tsconfig.json, project references)
pnpm lint         exit 0
pnpm test         98 suites, "# fail 0" in every one, 0 failing suites
```

`pnpm type-check` and `pnpm test` were each re-run standalone on the merged
main at `f966821f40cd0b6ba72d2bd746b952ed0b6b00aa`, not only inside `pnpm
verify`, and both exit 0.

`test:live-db` refuses locally by design:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

This is an environment gate, not a code failure, and it is unobtainable outside
the staging-ci environment. Required CI `verify` runs it with those credentials.
This lane is T2 and touches no DB surface.

### 7. R-level

```text
pnpm exec tsx scripts/ci/r-level-check.ts \
  --base f966821f40cd0b6ba72d2bd746b952ed0b6b00aa^ \
  --head f966821f40cd0b6ba72d2bd746b952ed0b6b00aa
Verdict: PASS
Changed files: 13
Rules matched: (none) — no R-level artifacts required for this diff
```

## Known gaps

- **A deliberately absent refusal.** There is no `lock_not_narrowed` check. The
  resulting lock is derived by filtering the previous lock, which makes such a
  check structurally unreachable — and an unreachable refusal cannot be
  validated by making it fail on the condition it names. Requirement 1 is
  carried instead by three reachable refusals (`path_not_in_lock`,
  `empty_resulting_lock`, `unexpected_field_mutation`), each mutation-proven.
  Shipping a fourth, decorative one would have inflated the refusal count
  without adding a control.
- **`no_release_paths` has a second, independent catcher.** With that refusal
  deleted, an empty release produces an audit entry with no `released_paths`,
  which `validateScopeReleaseHistory` rejects as
  `manifest_invalid_after_release`. The mutation assertion accounts for this
  explicitly rather than pretending the mutant sailed through.
- **The pure evaluator touches the filesystem once.** `evaluateScopeRelease`
  calls `validateManifest` on the manifest it is about to return, and that
  validator checks the preflight token exists on disk. This is why the
  "resulting lock remains valid" requirement is met at evaluation time rather
  than only at write time; the test fixture materializes its own token instead
  of depending on whatever tokens exist in the checkout.
- **The scope-release tests have no file of their own.** They live inside
  `scripts/ops/lane-manifest.test.ts` (24 of its 35 tests) rather than in a
  `scripts/ops/scope-release.test.ts`. The `executable-wiring` gate
  (`ops:automation-coverage-check`) fails any *new* `*.test.ts` that is not
  reachable from a package script or workflow command — an `import` chain from
  an already wired test file does **not** satisfy it, which was confirmed
  empirically: a first attempt shipped the separate file chained by import and
  CI returned `WIRING_TEST_UNWIRED_NEW`. Both remedies — adding the path to
  `package.json`'s `test:ops` list, or adding it to
  `docs/05_operations/executable-wiring-baseline.json` — require files outside
  this lane's frozen `file_scope_lock`, and baselining a brand-new suite as
  "unwired" would be false. Splitting the suite back out once `package.json` is
  in scope is follow-up work, and is itself an instance of the same class of
  problem this lane addresses: a frozen scope that cannot admit a file the work
  needs. Recorded as UTV2-1764 (backlog, unstaffed).
- **Concurrency detection is manifest-based.** `concurrent_lane_dependency`
  scans other lane manifests' `file_scope_lock`. A lane that has begun editing
  a path without declaring it in a manifest is invisible to this check, exactly
  as it is invisible to `ops:lane-start`'s own overlap check.
- This lane implements the mechanism only. It does not run a release against
  any lane, does not touch `scripts/ops/truth-check-lib.ts` or its test, does
  not repair any PR's red checks, and does not edit any other lane's manifest.
