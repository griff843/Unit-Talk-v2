# PROOF: UTV2-1586

MERGE_SHA: 1397ed887fa2c64ea6d836ed8eaac03e9fcd6830

## Summary

The post-merge lane closer can now bind a missing implementation PR only from
the exact trusted workflow context. It resolves and validates the original PR
before mutation, rolls back partial repair state on failure, and completes
terminal sync/lease/mutex/worktree cleanup on success.

ASSERTIONS:

- [x] Trusted explicit PR binding is accepted only in the exact post-merge
  workflow context and only together with repair mode.
- [x] PR repository, merge state, issue/branch identity, original artifacts,
  binding conflicts, authoritative merge SHA, and main reachability are
  validated before mutation.
- [x] Transaction rollback snapshots coordination state before
  auto-acquiring the merge mutex, preventing failed repair ghost capacity
- [x] Trusted repair records implementation and proof paths without polluting
  `files_changed` with lane manifest or per-issue sync control artifacts.
- [x] Successful trusted repair completes terminal manifest, sync, lease,
  mutex, and safe worktree cleanup.
- [x] The post-merge workflow stages a sync-file deletion after lane-close
  removes the working-tree file.
- [x] A candidate repair PR containing only the lane manifest and declared
  proof artifacts (no real implementation file) is rejected as a substitution
  attempt.

EVIDENCE:

## Independent review finding and correction

A fresh-context, independent Claude adversarial review (no prior involvement
in this implementation) returned APPROVE_WITH_NOTES with one real, verified
finding: `validateTrustedPostMergeRepair`'s substitution defense only checked
that a candidate PR's file list contained the lane manifest path and every
declared `expected_proof_paths` entry -- it never checked for any actual
implementation file. A forged PR containing only those two categories of file
(with zero real implementation content) would have passed every check, as
long as its branch name and title matched the target issue.

Corrected in commit `1397ed887fa2c64ea6d836ed8eaac03e9fcd6830`: added
`hasDeclaredImplementationFile()`, which requires at least one file in the
candidate PR to match the lane's own `file_scope_lock` (glob-aware for `/**`
entries) outside that lane's proof directory. A new focused test asserts a
manifest-and-proof-only candidate PR is rejected with `repair_pr_substitution`.
Exploiting the original gap still required genuine merge access to `main` on
the real repository (the same trust tier as every other path this lane
guards), so it was not a low-privilege bypass, but it was a real gap against
the design intent stated in this issue ("the supplied PR is the implementation
PR, not a later repair PR").

## Verification

The following commands were executed on the substantive branch head:

- `npx tsx --test scripts/ops/lane-close.test.ts`
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm test:db`
- `pnpm test:t1-proof:live`
- `pnpm verify`
- `npx tsx scripts/ops/lane-manifest.ts validate UTV2-1586 --json`
- `pnpm ops:proof-check UTV2-1586 --json`
- `git diff --check`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Focused lane close
1..109
# tests 109
# pass 109
# fail 0
# skipped 0

Focused workflow hardening
1..44
# tests 44
# pass 44
# fail 0
# skipped 0

Live database smoke
1..7
# tests 7
# pass 7
# fail 0
# skipped 0

pnpm verify
exit 0

Manifest validation
{"ok":true,"code":"manifest_valid","errors":[]}

JSON evidence bundle
Verdict: PASS

R-level
Verdict: PASS
```

The broader T1 live-proof battery completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test explicitly classifies that condition
as stale provider data, not a code regression.

This is executor-produced evidence for independent review. It is not a PM
verdict, does not add `t1-approved`, and does not authorize merge.
